import torch
from pathlib import Path

pth_files = list(Path("models").glob("*.pth"))

model_path = pth_files[0]

print("Loading:", model_path)

model = torch.load(
    model_path,
    map_location="cpu",
    weights_only=False
)

print("\nMODEL TYPE:")
print(type(model))

print("\nMODEL CLASSIFIER:")
print(model.classifier)

print("\nFINAL LAYER:")
print(model.classifier[-1])

print("\nNUMBER OF OUTPUTS:")
print(model.classifier[-1].out_features)