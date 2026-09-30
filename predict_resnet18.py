import argparse
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
DEFAULT_IMAGE_PATH = PROJECT_DIR / "test images" / "knee.png"
GRADE_LABELS = {
    0: "Grade 0",
    1: "Grade 1",
    2: "Grade 2",
}


def get_model_path():
    model_path = (
        FINETUNED_MODEL_PATH
        if FINETUNED_MODEL_PATH.exists()
        else BASE_MODEL_PATH
    )
    if not model_path.exists():
        raise SystemExit(f"ResNet18 model not found: {model_path}")
    return model_path


def build_transform():
    return transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.Grayscale(num_output_channels=3),
        transforms.ToTensor(),
        transforms.Normalize(
            mean=[0.485, 0.456, 0.406],
            std=[0.229, 0.224, 0.225],
        ),
    ])


def predict_image(model, image_path: Path):
    image = Image.open(image_path).convert("RGB")
    image_tensor = build_transform()(image).unsqueeze(0)

    with torch.no_grad():
        probabilities = F.softmax(model(image_tensor), dim=1)[0]

    predicted_class = probabilities.argmax().item()
    return predicted_class, probabilities


def main():
    parser = argparse.ArgumentParser(
        description="Predict severity class for a single X-ray image using the fine-tuned ResNet18 model."
    )
    parser.add_argument(
        "image",
        nargs="?",
        default=str(DEFAULT_IMAGE_PATH),
        help="Path to the image to predict (default: test images/knee.png)",
    )
    args = parser.parse_args()

    image_path = Path(args.image).resolve()
    if not image_path.exists():
        raise SystemExit(f"Image not found: {image_path}")

    model_path = get_model_path()
    print("Loading model:", model_path)
    model = torch.load(model_path, map_location="cpu", weights_only=False)
    model.eval()

    predicted_class, probabilities = predict_image(model, image_path)
    severity_label = GRADE_LABELS.get(predicted_class, "Unknown")

    print(f"\nImage: {image_path}")
    print(f"Predicted severity class: {predicted_class} ({severity_label})")
    print("Class probabilities:")
    for class_index, probability in enumerate(probabilities):
        class_label = GRADE_LABELS.get(class_index, "Unknown")
        print(f"Class {class_index} ({class_label}): {probability.item() * 100:.2f}%")


if __name__ == "__main__":
    main()