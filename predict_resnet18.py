from pathlib import Path

import torch
import torch.nn.functional as F
from PIL import Image
from torchvision import transforms


PROJECT_DIR = Path(__file__).resolve().parent
FINETUNED_MODEL_PATH = (
    PROJECT_DIR / "models" / "resnet18_3class_finetuned_best.pth"
)
BASE_MODEL_PATH = PROJECT_DIR / "models" / "resnet18_3class_best.pth"
MODEL_PATH = (
    FINETUNED_MODEL_PATH
    if FINETUNED_MODEL_PATH.exists()
    else BASE_MODEL_PATH
)
IMAGE_PATH = PROJECT_DIR / "test images" / "knee.png"

if not MODEL_PATH.exists():
    raise SystemExit(f"ResNet18 model not found: {MODEL_PATH}")
if not IMAGE_PATH.exists():
    raise SystemExit(f"Test image not found: {IMAGE_PATH}")

print("Loading model:", MODEL_PATH)
model = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
model.eval()

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.Grayscale(num_output_channels=3),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225]
    )
])

image = Image.open(IMAGE_PATH)
image_tensor = transform(image).unsqueeze(0)

with torch.no_grad():
    probabilities = F.softmax(model(image_tensor), dim=1)[0]

predicted_class = probabilities.argmax().item()
print("Predicted class:", predicted_class)
print("Class probabilities:")
for class_index, probability in enumerate(probabilities):
    print(f"Class {class_index}: {probability.item() * 100:.2f}%")