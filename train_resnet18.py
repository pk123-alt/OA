import time
from pathlib import Path

import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset
from torchvision import datasets, models, transforms


PROJECT_DIR = Path(__file__).resolve().parent
DATASET_DIR = Path(r"C:\Users\priyanka\Downloads\Knee osteo with severity")
MODEL_DIR = PROJECT_DIR / "models"
MODEL_DIR.mkdir(exist_ok=True)
INITIAL_MODEL_PATH = MODEL_DIR / "resnet18_3class_best.pth"
SAVE_PATH = MODEL_DIR / "resnet18_3class_finetuned_best.pth"
MAX_TRAIN_IMAGES_PER_CLASS = 1000
EPOCHS = 8
EARLY_STOPPING_PATIENCE = 4
GRADE_NAMES = ("0", "1", "2")


class GradeSubset(Dataset):
    def __init__(self, dataset, max_images_per_class=None, seed=42):
        self.dataset = dataset
        missing_grades = [
            grade for grade in GRADE_NAMES
            if grade not in dataset.class_to_idx
        ]
        if missing_grades:
            raise RuntimeError(
                f"Missing required grade folders: {missing_grades}"
            )

        generator = torch.Generator().manual_seed(seed)
        self.samples = []
        for output_label, grade in enumerate(GRADE_NAMES):
            source_label = dataset.class_to_idx[grade]
            indices = [
                index for index, target in enumerate(dataset.targets)
                if target == source_label
            ]
            if not indices:
                raise RuntimeError(f"No images found for grade {grade}")

            if max_images_per_class is not None and len(indices) > max_images_per_class:
                order = torch.randperm(len(indices), generator=generator)
                indices = [
                    indices[index]
                    for index in order[:max_images_per_class].tolist()
                ]
            self.samples.extend(
                (index, output_label) for index in indices
            )

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, index):
        dataset_index, output_label = self.samples[index]
        image, _ = self.dataset[dataset_index]
        return image, output_label

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print("Device:", device)

train_transform = transforms.Compose([
    transforms.Grayscale(num_output_channels=3),
    transforms.Resize((224, 224)),
    transforms.RandomHorizontalFlip(),
    transforms.RandomRotation(10),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

val_transform = transforms.Compose([
    transforms.Grayscale(num_output_channels=3),
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

train_dataset = datasets.ImageFolder(
    DATASET_DIR / "train",
    transform=train_transform
)
val_dataset = datasets.ImageFolder(
    DATASET_DIR / "val",
    transform=val_transform
)

print("\nDataset folders found:", train_dataset.classes)
print("Grades used:", GRADE_NAMES)

train_subset = GradeSubset(
    train_dataset,
    max_images_per_class=MAX_TRAIN_IMAGES_PER_CLASS
)
val_subset = GradeSubset(val_dataset)
print(
    "Training images used:", len(train_subset),
    "of", len(train_dataset)
)
print(
    "Validation images used:", len(val_subset),
    "of", len(val_dataset)
)

train_loader = DataLoader(
    train_subset,
    batch_size=16,
    shuffle=True,
    num_workers=0
)
val_loader = DataLoader(
    val_subset,
    batch_size=16,
    shuffle=False,
    num_workers=0
)

print("\nLoading ResNet18 for fine-tuning...")
if INITIAL_MODEL_PATH.exists():
    print("Starting from:", INITIAL_MODEL_PATH)
    model = torch.load(
        INITIAL_MODEL_PATH,
        map_location="cpu",
        weights_only=False
    )
else:
    model = models.resnet18(weights=models.ResNet18_Weights.DEFAULT)
    model.fc = nn.Sequential(
        nn.Dropout(p=0.3),
        nn.Linear(model.fc.in_features, 3)
    )

for parameter in model.parameters():
    parameter.requires_grad = False
for parameter in model.layer4.parameters():
    parameter.requires_grad = True
for parameter in model.fc.parameters():
    parameter.requires_grad = True
model = model.to(device)

print("Final layer:")
print(model.fc)
print("Fine-tuning layer4 and the classifier; earlier layers are frozen.")

criterion = nn.CrossEntropyLoss()
optimizer = torch.optim.Adam([
    {"params": model.layer4.parameters(), "lr": 0.00001},
    {"params": model.fc.parameters(), "lr": 0.0001}
])

def evaluate(model, loader):
    model.eval()
    confusion = torch.zeros(3, 3, dtype=torch.int64)
    loss_total = 0.0

    with torch.no_grad():
        for images, labels in loader:
            outputs = model(images.to(device))
            labels = labels.to(device)
            loss_total += criterion(outputs, labels).item()
            predictions = outputs.argmax(dim=1)
            encoded = labels * 3 + predictions
            confusion += torch.bincount(
                encoded.cpu(), minlength=9
            ).reshape(3, 3)

    recalls = confusion.diag().float() / confusion.sum(dim=1).clamp_min(1)
    accuracy = 100 * confusion.diag().sum().item() / confusion.sum().item()
    balanced_accuracy = 100 * recalls.mean().item()
    average_loss = loss_total / len(loader)
    return average_loss, accuracy, balanced_accuracy, recalls.tolist()


baseline_loss, baseline_accuracy, best_balanced_accuracy, baseline_recalls = (
    evaluate(model, val_loader)
)
print(
    "Starting validation: "
    f"Acc {baseline_accuracy:.2f}% | "
    f"Balanced Acc {best_balanced_accuracy:.2f}% | "
    f"Grade recalls {[round(value * 100, 2) for value in baseline_recalls]}"
)
epochs_without_improvement = 0

print("\nStarting ResNet18 fine-tuning...\n")

for epoch in range(EPOCHS):
    epoch_start = time.time()
    model.train()
    model.bn1.eval()
    model.layer1.eval()
    model.layer2.eval()
    model.layer3.eval()
    running_loss = 0.0
    correct = 0
    total = 0

    for batch_idx, (images, labels) in enumerate(train_loader):
        images = images.to(device)
        labels = labels.to(device)

        optimizer.zero_grad()
        outputs = model(images)
        loss = criterion(outputs, labels)
        loss.backward()
        optimizer.step()

        running_loss += loss.item()
        predicted = outputs.argmax(dim=1)
        total += labels.size(0)
        correct += (predicted == labels).sum().item()

        if (batch_idx + 1) % 20 == 0 or batch_idx == len(train_loader) - 1:
            batch_progress = batch_idx + 1
            print(
                f"Epoch {epoch + 1}/{EPOCHS} | "
                f"Batch {batch_progress}/{len(train_loader)} | "
                f"Avg Loss: {running_loss / batch_progress:.4f} | "
                f"Train Acc: {100 * correct / total:.2f}%"
            )

    train_accuracy = 100 * correct / total
    train_loss = running_loss / len(train_loader)

    val_loss, val_accuracy, balanced_accuracy, grade_recalls = evaluate(
        model,
        val_loader
    )
    epoch_time = time.time() - epoch_start

    print(
        f"Epoch [{epoch + 1}/{EPOCHS}] "
        f"Train Loss: {train_loss:.4f} "
        f"Train Acc: {train_accuracy:.2f}% "
        f"Val Loss: {val_loss:.4f} "
        f"Val Acc: {val_accuracy:.2f}% "
        f"Balanced Val Acc: {balanced_accuracy:.2f}% "
        f"Grade Recalls: {[round(value * 100, 2) for value in grade_recalls]} "
        f"Time: {epoch_time / 60:.2f} min"
    )

    if balanced_accuracy > best_balanced_accuracy:
        best_balanced_accuracy = balanced_accuracy
        epochs_without_improvement = 0
        torch.save(model, SAVE_PATH)
        print(
            f"  >>> Best fine-tuned ResNet18 saved! "
            f"Balanced validation accuracy: {balanced_accuracy:.2f}%"
        )
    else:
        epochs_without_improvement += 1
        if epochs_without_improvement >= EARLY_STOPPING_PATIENCE:
            print("Early stopping: balanced validation accuracy did not improve.")
            break

print("\n========================================")
print("RESNET18 FINE-TUNING COMPLETE")
print("========================================")
print("Best balanced validation accuracy:", f"{best_balanced_accuracy:.2f}%")
print("Model saved to:")
print(SAVE_PATH if SAVE_PATH.exists() else INITIAL_MODEL_PATH)