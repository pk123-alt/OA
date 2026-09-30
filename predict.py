import torch
import torch.nn.functional as F
from torchvision import transforms
from PIL import Image
from pathlib import Path


# -----------------------------
# 1. Paths
# -----------------------------
MODEL_DIR = Path("models")
IMAGE_PATH = Path("test images/knee.png")


# -----------------------------
# 2. Find the .pth model
# -----------------------------
pth_files = list(MODEL_DIR.glob("*.pth"))

if not pth_files:
    print("ERROR: No .pth model found inside models/")
    exit()

MODEL_PATH = pth_files[0]

print("Loading model:")
print(MODEL_PATH)
print("Model size:", round(MODEL_PATH.stat().st_size / (1024 * 1024), 2), "MB")


# -----------------------------
# 3. Load the VGG-19 model
# -----------------------------
model = torch.load(
    MODEL_PATH,
    map_location="cpu",
    weights_only=False
)

# Compatibility fix for this older VGG model
model.avgpool = torch.nn.Identity()

model.eval()


# -----------------------------
# 4. Image preprocessing
# -----------------------------
transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.Grayscale(num_output_channels=3),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])


# -----------------------------
# 5. Load X-ray
# -----------------------------
if not IMAGE_PATH.exists():
    print("\nERROR: Image not found:")
    print(IMAGE_PATH)
    exit()

image = Image.open(IMAGE_PATH)

print("\nImage loaded:")
print("Original size:", image.size)
print("Image mode:", image.mode)


# -----------------------------
# 6. Prepare image
# -----------------------------
image_tensor = transform(image)
image_tensor = image_tensor.unsqueeze(0)


# -----------------------------
# 7. Run prediction
# -----------------------------
with torch.no_grad():
    output = model(image_tensor)

probabilities = F.softmax(output, dim=1)

predicted_class = torch.argmax(probabilities, dim=1).item()


# -----------------------------
# 8. Display results
# -----------------------------
print("\n==============================")
print("       OA PREDICTION")
print("==============================")

print("Predicted class:", predicted_class)

print("\nClass probabilities:")

for i, probability in enumerate(probabilities[0]):
    print(
        f"Class {i}: {probability.item() * 100:.2f}%"
    )

print("==============================")