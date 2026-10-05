from __future__ import annotations

from io import StringIO
from itertools import product
from pathlib import Path
from typing import Iterable, List, Tuple

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset


LABEL_ALIASES = {
    "healthy": "Healthy",
    "hs": "Healthy",
    "normal": "Healthy",
    "control": "Healthy",
    "hoa": "Hip Osteoarthritis",
    "koa": "Knee Osteoarthritis",
    "osteoarthritis": "Osteoarthritis",
    "osteo": "Osteoarthritis",
    "arthritic": "Osteoarthritis",
    "knee_oa": "Osteoarthritis",
    "elbow_oa": "Osteoarthritis",
}


class GaitSignalClassifier(nn.Module):
    def __init__(self, input_channels: int = 1, num_classes: int = 2):
        super().__init__()
        self.model = nn.Sequential(
            nn.Conv1d(input_channels, 32, kernel_size=9, padding=4),
            nn.ReLU(),
            nn.BatchNorm1d(32),
            nn.Conv1d(32, 64, kernel_size=7, padding=3),
            nn.ReLU(),
            nn.BatchNorm1d(64),
            nn.MaxPool1d(2),
            nn.Conv1d(64, 128, kernel_size=5, padding=2),
            nn.ReLU(),
            nn.BatchNorm1d(128),
            nn.AdaptiveAvgPool1d(1),
            nn.Flatten(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(64, num_classes),
        )

    def forward(self, x):
        return self.model(x)


class SignalDataset(Dataset):
    def __init__(self, records, target_length: int = 256):
        self.records = [
            (standardize_signal(record[0], target_length), record[1])
            for record in records
        ]
        self.labels = sorted({label for _, label in self.records})
        self.label_to_index = {label: index for index, label in enumerate(self.labels)}
        self.samples = [
            (torch.tensor(signal, dtype=torch.float32).transpose(0, 1), self.label_to_index[label])
            for signal, label in self.records
        ]

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        signal, label = self.samples[index]
        return signal, label


def _subject_balanced_weights(records, indices, class_multipliers=None):
    class_multipliers = class_multipliers or {}
    subjects_by_label = {}
    for index in indices:
        _, label, subject_id = records[index]
        subjects_by_label.setdefault(label, {}).setdefault(subject_id, 0)
        subjects_by_label[label][subject_id] += 1

    class_subject_counts = {
        label: len(subjects)
        for label, subjects in subjects_by_label.items()
    }
    return [
        class_multipliers.get(label, 1.0)
        / (class_subject_counts[label] * subjects_by_label[label][subject_id])
        for index in indices
        for _, label, subject_id in [records[index]]
    ]


def optimize_class_thresholds(logits, labels, min_recall: float = 0.6, candidate_thresholds=None):
    logits = np.asarray(logits, dtype=np.float32)
    labels = np.asarray(labels, dtype=np.int64)
    if logits.ndim != 2:
        raise ValueError("logits must be a 2D array shaped [samples, classes].")
    if labels.ndim != 1:
        raise ValueError("labels must be a 1D vector matching the number of samples.")
    if logits.shape[0] != labels.shape[0]:
        raise ValueError("The number of logits rows must match the number of labels.")

    num_classes = logits.shape[1]
    if candidate_thresholds is None:
        candidate_thresholds = np.linspace(0.15, 0.85, 15, dtype=np.float32)
    candidate_thresholds = np.asarray(candidate_thresholds, dtype=np.float32)

    probabilities = torch.softmax(torch.tensor(logits), dim=1).numpy()
    best_thresholds = np.full(num_classes, 0.5, dtype=np.float32)
    best_score = -1.0
    best_recalls = None

    for thresholds in product(candidate_thresholds, repeat=num_classes):
        thresholds = np.asarray(thresholds, dtype=np.float32)
        predictions = []
        for sample_probs in probabilities:
            valid_classes = np.where(sample_probs >= thresholds)[0]
            if valid_classes.size == 0:
                predictions.append(int(np.argmax(sample_probs)))
            else:
                winner = valid_classes[np.argmax(sample_probs[valid_classes])]
                predictions.append(int(winner))

        predictions = np.asarray(predictions, dtype=np.int64)
        recalls = []
        for class_index in range(num_classes):
            positives = labels == class_index
            if not np.any(positives):
                recalls.append(1.0)
            else:
                recalls.append(float(np.mean(predictions[positives] == class_index)))

        if all(recall >= min_recall for recall in recalls):
            score = float(min(recalls))
            if score > best_score or (np.isclose(score, best_score) and np.sum(thresholds) < np.sum(best_thresholds)):
                best_score = score
                best_thresholds = thresholds
                best_recalls = recalls

    if best_recalls is None:
        best_thresholds = np.full(num_classes, 0.5, dtype=np.float32)
        best_recalls = [0.0] * num_classes

    return best_thresholds.astype(np.float32).tolist()


def infer_label_from_path(path: str | Path, binary_classification: bool = False) -> str:
    parts = Path(str(path).replace("\\", "/")).parts
    for part in reversed(parts):
        label = LABEL_ALIASES.get(part.lower())
        if label is not None:
            if binary_classification and label in {"Hip Osteoarthritis", "Knee Osteoarthritis", "Osteoarthritis"}:
                return "Osteoarthritis"
            return label
    return "Unknown"


def _normalize_header_first_column(header: str | None) -> str:
    if not header:
        return ""

    for delimiter in ("\t", ",", ";", " "):
        if delimiter in header:
            return header.split(delimiter, 1)[0].strip().lower()
    return header.strip().lower()


def _drop_packet_counter_column(signal: np.ndarray, file_path: str | Path | None = None, header: str | None = None) -> np.ndarray:
    if signal.ndim != 2 or signal.shape[1] <= 1:
        return signal

    if header is None and file_path is not None:
        try:
            text = Path(file_path).read_text(encoding="utf-8-sig", errors="ignore")
        except OSError:
            return signal
        lines = text.splitlines()
        if lines:
            header = lines[0]

    if _normalize_header_first_column(header) == "packetcounter":
        return signal[:, 1:]
    return signal


def _read_numeric_matrix(path: str | Path) -> np.ndarray:
    file_path = Path(path)
    try:
        text = file_path.read_text(encoding="utf-8-sig", errors="ignore")
    except OSError as exc:  # pragma: no cover - defensive path
        raise ValueError(f"Unable to read signal file: {file_path}") from exc

    if not text.strip():
        raise ValueError(f"Signal file is empty: {file_path}")

    delimiter_candidates = ["\t", ",", ";", " "]
    for delimiter in delimiter_candidates:
        for skip_header in (0, 1):
            try:
                data = np.genfromtxt(
                    StringIO(text),
                    delimiter=delimiter,
                    dtype=np.float64,
                    skip_header=skip_header,
                    invalid_raise=False,
                )
            except Exception:  # pragma: no cover - broader compatibility
                continue
            if np.asarray(data).size == 0:
                continue
            data = np.asarray(data, dtype=np.float64)
            if data.ndim == 1:
                finite_values = data[np.isfinite(data)]
                if finite_values.size:
                    return finite_values.astype(np.float32)
            else:
                complete_rows = data[np.isfinite(data).all(axis=1)]
                if complete_rows.size:
                    return complete_rows.astype(np.float32)

    raise ValueError(f"Could not parse numeric signal data from: {file_path}")


def standardize_signal(signal: Iterable[float] | np.ndarray, target_length: int = 256) -> np.ndarray:
    array = np.asarray(signal, dtype=np.float32)
    if array.size == 0:
        raise ValueError("Signal is empty; cannot standardize a blank signal.")

    if array.ndim == 1:
        array = array.reshape(-1, 1)
    else:
        array = np.asarray(array, dtype=np.float32)

    if array.shape[0] == 0:
        raise ValueError("Signal must contain at least one time step.")

    if array.shape[0] != target_length:
        old_axis = np.linspace(0, array.shape[0] - 1, array.shape[0], dtype=np.float32)
        new_axis = np.linspace(0, array.shape[0] - 1, target_length, dtype=np.float32)
        interpolated = np.zeros((target_length, array.shape[1]), dtype=np.float32)
        for channel_index in range(array.shape[1]):
            interpolated[:, channel_index] = np.interp(new_axis, old_axis, array[:, channel_index])
        array = interpolated

    mean = array.mean(axis=0, keepdims=True)
    std = array.std(axis=0, keepdims=True)
    std[std == 0.0] = 1.0
    return ((array - mean) / std).astype(np.float32)


def load_signal_dataset(
    dataset_root: str | Path,
    target_length: int = 256,
    binary_classification: bool = True,
) -> Tuple[List[Tuple[np.ndarray, str, str]], List[str]]:
    dataset_path = Path(dataset_root)
    if not dataset_path.exists():
        raise FileNotFoundError(f"Dataset folder not found: {dataset_path}")

    candidate_files = [
        file_path
        for file_path in sorted(dataset_path.rglob("*"))
        if file_path.is_file()
        and file_path.suffix.lower() in {".csv", ".txt", ".tsv", ".npy"}
    ]
    cohort_parts = {
        part.lower()
        for file_path in candidate_files
        for part in file_path.parts
    }
    use_figshare_cohorts = {"hs", "hoa", "koa"}.issubset(cohort_parts)

    signals: List[Tuple[np.ndarray, str, str]] = []
    for file_path in candidate_files:
        path_parts = [part.lower() for part in file_path.parts]
        if use_figshare_cohorts:
            if not file_path.name.lower().endswith("_processed_data.txt"):
                continue
            if not any(cohort in path_parts for cohort in ("hs", "hoa", "koa")):
                continue
        elif "_raw_data_" in file_path.name.lower():
            continue

        if file_path.suffix.lower() not in {".csv", ".txt", ".tsv", ".npy"}:
            continue

        label = infer_label_from_path(file_path, binary_classification=binary_classification)
        if label == "Unknown":
            continue

        if file_path.suffix.lower() == ".npy":
            signal = np.asarray(np.load(file_path), dtype=np.float32)
        else:
            signal = _read_numeric_matrix(file_path)
            signal = _drop_packet_counter_column(signal, file_path=file_path)

        signal = standardize_signal(signal, target_length)
        subject_id = file_path.stem
        for cohort in ("hs", "hoa", "koa"):
            if cohort in path_parts:
                cohort_index = path_parts.index(cohort)
                if cohort_index + 1 < len(path_parts) - 1:
                    subject_id = path_parts[cohort_index + 1]
                break
        signals.append((signal, label, f"{label}:{subject_id}"))

    if not signals:
        raise ValueError(
            f"No usable gait signal files were found under {dataset_path}. "
            "Expected folders such as healthy/ and osteoarthritis/ with .csv or .txt numeric samples."
        )

    ordered_labels = sorted({label for _, label, _ in signals})
    return signals, ordered_labels


def build_dataloader(records, labels, batch_size: int = 16, shuffle: bool = True, target_length: int = 256):
    dataset = SignalDataset(records, target_length=target_length)
    dataset.labels = labels
    dataset.label_to_index = {label: index for index, label in enumerate(labels)}
    dataset.samples = [
        (
            torch.tensor(standardize_signal(record[0], target_length), dtype=torch.float32).transpose(0, 1),
            dataset.label_to_index[record[1]],
        )
        for record in records
    ]
    return DataLoader(dataset, batch_size=batch_size, shuffle=shuffle)


def train_oa_signal_model(
    dataset_root: str | Path,
    output_path: str | Path = "models/oa_signal_model.pth",
    target_length: int = 256,
    epochs: int = 20,
    batch_size: int = 16,
    learning_rate: float = 1e-3,
    class_sampling_multipliers: dict[str, float] | None = None,
    seed: int = 42,
    min_recall_target: float = 0.6,
) -> dict:
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)

    records, labels = load_signal_dataset(dataset_root, target_length=target_length, binary_classification=True)
    if len(labels) < 2:
        raise ValueError(f"At least two label groups are required. Found labels: {labels}")
    if any(value <= 0 for value in (class_sampling_multipliers or {}).values()):
        raise ValueError("Class sampling multipliers must be greater than zero.")

    normalized_class_multipliers = {}
    for label, weight in (class_sampling_multipliers or {}).items():
        normalized_key = label
        if label in {"Hip Osteoarthritis", "Knee Osteoarthritis", "Osteoarthritis"}:
            normalized_key = "Osteoarthritis"
        normalized_class_multipliers[normalized_key] = weight

    dataset = SignalDataset(records, target_length=target_length)
    dataset.labels = labels
    dataset.label_to_index = {label: index for index, label in enumerate(labels)}
    dataset.samples = [
        (
            torch.tensor(standardize_signal(record[0], target_length), dtype=torch.float32).transpose(0, 1),
            dataset.label_to_index[record[1]],
        )
        for record in records
    ]

    split_generator = torch.Generator().manual_seed(42)
    subjects_by_label = {}
    for signal_index, (_, label, subject_id) in enumerate(records):
        subjects_by_label.setdefault(label, {}).setdefault(subject_id, []).append(signal_index)

    train_indices = []
    val_indices = []
    for label, subjects in subjects_by_label.items():
        subject_ids = sorted(subjects)
        if len(subject_ids) < 2:
            raise ValueError(
                f"At least two distinct subjects are required for class {label} "
                "to create a subject-independent validation split."
            )
        order = torch.randperm(len(subject_ids), generator=split_generator).tolist()
        shuffled_subjects = [subject_ids[index] for index in order]
        validation_count = min(
            len(shuffled_subjects) - 1,
            max(1, round(len(shuffled_subjects) * 0.2)),
        )
        validation_subjects = set(shuffled_subjects[:validation_count])
        for subject_id, indices in subjects.items():
            target_indices = val_indices if subject_id in validation_subjects else train_indices
            target_indices.extend(indices)

    train_dataset = torch.utils.data.Subset(dataset, train_indices)
    val_dataset = torch.utils.data.Subset(dataset, val_indices)

    sampler = torch.utils.data.WeightedRandomSampler(
        weights=torch.tensor(
            _subject_balanced_weights(
                records,
                train_indices,
                class_multipliers=normalized_class_multipliers,
            ),
            dtype=torch.double,
        ),
        num_samples=len(train_indices),
        replacement=True,
        generator=torch.Generator().manual_seed(seed),
    )
    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        sampler=sampler,
        generator=torch.Generator().manual_seed(seed),
    )
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)

    model = GaitSignalClassifier(input_channels=dataset[0][0].shape[0], num_classes=len(labels))
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model.to(device)

    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(model.parameters(), lr=learning_rate)

    best_state = None
    best_val_loss = float("inf")
    best_balanced_accuracy = -1.0
    best_thresholds = None

    for _ in range(epochs):
        model.train()
        for signal_batch, label_batch in train_loader:
            signal_batch = signal_batch.to(device)
            label_batch = label_batch.to(device)
            optimizer.zero_grad()
            logits = model(signal_batch)
            loss = criterion(logits, label_batch)
            loss.backward()
            optimizer.step()

        model.eval()
        val_loss = 0.0
        confusion = torch.zeros(len(labels), len(labels), dtype=torch.int64)
        val_logits = []
        val_sample_labels = []
        with torch.no_grad():
            for signal_batch, label_batch in val_loader:
                signal_batch = signal_batch.to(device)
                label_batch = label_batch.to(device)
                logits = model(signal_batch)
                val_logits.append(logits.cpu().numpy())
                val_sample_labels.append(label_batch.cpu().numpy())
                val_loss += criterion(logits, label_batch).item()
                predictions = logits.argmax(dim=1)
                encoded = label_batch * len(labels) + predictions
                confusion += torch.bincount(
                    encoded.cpu(), minlength=len(labels) ** 2
                ).reshape(len(labels), len(labels))

        val_loss /= max(1, len(val_loader))
        recalls = confusion.diag().float() / confusion.sum(dim=1).clamp_min(1)
        balanced_accuracy = recalls.mean().item()
        if len(val_logits) > 0:
            stacked_logits = np.concatenate(val_logits, axis=0)
            stacked_labels = np.concatenate(val_sample_labels, axis=0)
            candidate_thresholds = optimize_class_thresholds(
                stacked_logits,
                stacked_labels,
                min_recall=min_recall_target,
            )
            best_thresholds = candidate_thresholds

        if (
            balanced_accuracy > best_balanced_accuracy
            or (balanced_accuracy == best_balanced_accuracy and val_loss < best_val_loss)
        ):
            best_balanced_accuracy = balanced_accuracy
            best_val_loss = val_loss
            best_state = {key: value.cpu().clone() for key, value in model.state_dict().items()}

    if best_state is None:
        raise RuntimeError("Training completed without producing a valid model state.")

    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "state_dict": best_state,
        "class_names": labels,
        "target_length": target_length,
        "input_channels": dataset[0][0].shape[0],
        "validation_balanced_accuracy": best_balanced_accuracy,
        "class_sampling_multipliers": normalized_class_multipliers,
        "seed": seed,
        "decision_thresholds": best_thresholds or [0.5] * len(labels),
    }
    torch.save(payload, output_file)
    return payload


def load_trained_model(model_path: str | Path):
    file_path = Path(model_path)
    if not file_path.exists():
        raise FileNotFoundError(f"OA signal model was not found: {file_path}")

    payload = torch.load(file_path, map_location="cpu", weights_only=False)
    class_names = payload.get("class_names", ["Healthy", "Osteoarthritis"])
    input_channels = int(payload.get("input_channels", 1))
    target_length = int(payload.get("target_length", 256))
    model = GaitSignalClassifier(input_channels=input_channels, num_classes=len(class_names))
    model.load_state_dict(payload["state_dict"])
    model.eval()
    return model, class_names, target_length


def predict_signal_file(model_path: str | Path, signal_path: str | Path):
    model, class_names, target_length = load_trained_model(model_path)
    signal_file = Path(signal_path)
    if not signal_file.exists():
        raise FileNotFoundError(f"Signal file not found: {signal_file}")

    signal = _read_numeric_matrix(signal_file)
    signal = _drop_packet_counter_column(signal, file_path=signal_file)

    standardized = standardize_signal(signal, target_length)
    tensor = torch.tensor(standardized, dtype=torch.float32).transpose(0, 1).unsqueeze(0)
    with torch.no_grad():
        logits = model(tensor)
        probabilities = torch.softmax(logits, dim=1).squeeze(0)
        prediction_index = int(probabilities.argmax().item())

    predicted_label = class_names[prediction_index]
    return {
        "predicted_label": predicted_label,
        "prediction_index": prediction_index,
        "class_names": class_names,
        "probabilities": {
            class_names[index]: float(probabilities[index].item())
            for index in range(len(class_names))
        },
    }
