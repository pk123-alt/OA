import time
import torch
import torch.nn as nn
from torch.utils.data import DataLoader
from torchvision import datasets, transforms, models
from pathlib import Path

# ============================================================
# PATHS
# ============================================================

DATASET_DIR = Path(r"C:\Users\priyanka\Downloads\Knee osteo with severity")
MODEL_DIR = Path("models")
MODEL_DIR.mkdir(exist_ok=True)

SAVE_PATH = MODEL_DIR / "vgg19_3class_best.pth"

# ============================================================
# DEVICE
# ============================================================

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

print("Device:", device)

# ============================================================
# IMAGE TRANSFORMS
# ============================================================

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

# ============================================================
# DATASETS
# ============================================================

train_dir = DATASET_DIR / "train"
val_dir = DATASET_DIR / "val"

train_dataset = datasets.ImageFolder(
    train_dir,
    transform=train_transform
)

val_dataset = datasets.ImageFolder(
    val_dir,
    transform=val_transform
)

print("\nClasses:", train_dataset.classes)
print("Class mapping:", train_dataset.class_to_idx)

print("Training images:", len(train_dataset))
print("Validation images:", len(val_dataset))

# Make sure we really have only 3 classes
if len(train_dataset.classes) != 3:
    raise RuntimeError(
        f"Expected 3 classes, but found {train_dataset.classes}"
    )

# ============================================================
# DATALOADERS
# ============================================================

train_loader = DataLoader(
    train_dataset,
    batch_size=16,
    shuffle=True,
    num_workers=0
)

val_loader = DataLoader(
    val_dataset,
    batch_size=16,
    shuffle=False,
    num_workers=0
)

# ============================================================
# MODEL
# ============================================================

print("\nLoading VGG-19...")

# Use ImageNet pretrained VGG-19
model = models.vgg19(weights=models.VGG19_Weights.DEFAULT)

# Replace final layer
model.classifier[6] = nn.Linear(4096, 3)

model = model.to(device)

print("Final layer:")
print(model.classifier[6])

# ============================================================
# LOSS + OPTIMIZER
# ============================================================

criterion = nn.CrossEntropyLoss()

optimizer = torch.optim.Adam(
    model.parameters(),
    lr=0.0001
)

# ============================================================
# TRAINING
# ============================================================

EPOCHS = 15

best_val_accuracy = 0.0

print("\nStarting training...\n")

for epoch in range(EPOCHS):
    epoch_start = time.time()

    # --------------------------------------------------------
    # TRAIN
    # --------------------------------------------------------

    model.train()

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

        _, predicted = torch.max(outputs, 1)

        total += labels.size(0)
        correct += (predicted == labels).sum().item()

        if (batch_idx + 1) % 20 == 0 or batch_idx == len(train_loader) - 1:
            batch_progress = batch_idx + 1
            avg_loss = running_loss / batch_progress
            batch_acc = 100 * correct / total
            print(
                f"Epoch {epoch + 1}/{EPOCHS} | "
                f"Batch {batch_progress}/{len(train_loader)} | "
                f"Avg Loss: {avg_loss:.4f} | "
                f"Train Acc: {batch_acc:.2f}%"
            )

    train_accuracy = 100 * correct / total
    train_loss = running_loss / len(train_loader)

    # --------------------------------------------------------
    # VALIDATION
    # --------------------------------------------------------

    model.eval()

    val_correct = 0
    val_total = 0
    val_loss_total = 0.0

    with torch.no_grad():

        for images, labels in val_loader:

            images = images.to(device)
            labels = labels.to(device)

            outputs = model(images)

            loss = criterion(outputs, labels)

            val_loss_total += loss.item()

            _, predicted = torch.max(outputs, 1)

            val_total += labels.size(0)
            val_correct += (predicted == labels).sum().item()

    val_accuracy = 100 * val_correct / val_total
    val_loss = val_loss_total / len(val_loader)

    epoch_time = time.time() - epoch_start
    print(
        f"Epoch [{epoch + 1}/{EPOCHS}] "
        f"Train Loss: {train_loss:.4f} "
        f"Train Acc: {train_accuracy:.2f}% "
        f"Val Loss: {val_loss:.4f} "
        f"Val Acc: {val_accuracy:.2f}% "
        f"Time: {epoch_time/60:.2f} min"
    )

    # --------------------------------------------------------
    # SAVE BEST MODEL
    # --------------------------------------------------------

    if val_accuracy > best_val_accuracy:

        best_val_accuracy = val_accuracy

        torch.save(model, SAVE_PATH)

        print(
            f"  >>> Best model saved! "
            f"Validation accuracy: {val_accuracy:.2f}%"
        )

print("\n========================================")
print("TRAINING COMPLETE")
print("========================================")

print("Best validation accuracy:",
      f"{best_val_accuracy:.2f}%")

print("Model saved to:")
print(SAVE_PATH)