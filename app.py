from pathlib import Path
import io

import torch
import torch.nn.functional as F
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image
from torchvision import transforms

from oa_signal_model import predict_signal_file


PROJECT_DIR = Path(__file__).resolve().parent
MODEL_PATH = PROJECT_DIR / "models" / "resnet18_3class_finetuned_best.pth"
OA_GAIT_MODEL_PATH = PROJECT_DIR / "models" / "oa_binary_model.pth"
GRADE_LABELS = {
    0: "Grade 0",
    1: "Grade 1",
    2: "Grade 2",
}

if not MODEL_PATH.exists():
    raise FileNotFoundError(f"Fine-tuned model not found: {MODEL_PATH}")

model = torch.load(MODEL_PATH, map_location="cpu", weights_only=False)
model.eval()

transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.Grayscale(num_output_channels=3),
    transforms.ToTensor(),
    transforms.Normalize(
        mean=[0.485, 0.456, 0.406],
        std=[0.229, 0.224, 0.225],
    ),
])

app = FastAPI(title="OA Knee Severity Predictor")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "model": str(MODEL_PATH.name),
        "grades": ["Grade 0", "Grade 1", "Grade 2"],
    }


@app.post("/predict")
async def predict_severity(file: UploadFile = File(...)):
    if not file.content_type or "image" not in file.content_type:
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    try:
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        image_tensor = transform(image).unsqueeze(0)

        with torch.no_grad():
            probabilities = F.softmax(model(image_tensor), dim=1)[0]

        predicted_class = int(probabilities.argmax().item())
        predicted_label = GRADE_LABELS.get(predicted_class, "Unknown")

        response = {
            "predicted_class": predicted_class,
            "severity": predicted_label,
            "probabilities": {
                str(class_index): round(float(probability.item()), 4)
                for class_index, probability in enumerate(probabilities)
            },
            "grade_labels": {
                str(class_index): GRADE_LABELS.get(class_index, "Unknown")
                for class_index in range(len(probabilities))
            },
        }
        return response
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to process image: {exc}")


@app.post("/predict-oa-gait")
async def predict_oa_gait(file: UploadFile = File(...)):
    if not file.content_type or "text" not in file.content_type and "plain" not in file.content_type and "csv" not in file.content_type:
        raise HTTPException(status_code=400, detail="Please upload a gait signal text/csv file.")

    try:
        if not OA_GAIT_MODEL_PATH.exists():
            raise FileNotFoundError(f"OA gait model not found: {OA_GAIT_MODEL_PATH}")

        signal_bytes = await file.read()
        suffix = Path(file.filename).suffix if file.filename else ".txt"
        temp_signal_path = PROJECT_DIR / f"tmp_oa_signal_upload{suffix}"
        temp_signal_path.write_bytes(signal_bytes)

        result = predict_signal_file(OA_GAIT_MODEL_PATH, temp_signal_path)
        temp_signal_path.unlink(missing_ok=True)

        return {
            "predicted_label": result["predicted_label"],
            "prediction_index": result["prediction_index"],
            "class_names": result["class_names"],
            "probabilities": result["probabilities"],
            "model": OA_GAIT_MODEL_PATH.name,
        }
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Unable to process gait signal: {exc}")
