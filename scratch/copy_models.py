import os
import shutil

src_dir = "/home/meghapranay/ArcFlow-main/backend/models"
dst_dir = "/home/meghapranay/lumina/backend/models"

os.makedirs(dst_dir, exist_ok=True)

files = ["yolov8n.onnx", "yamnet.onnx", "yamnet.data"]

for f in files:
    src_path = os.path.join(src_dir, f)
    dst_path = os.path.join(dst_dir, f)
    print(f"Copying {src_path} -> {dst_path}...")
    try:
        with open(src_path, "rb") as sf:
            with open(dst_path, "wb") as df:
                shutil.copyfileobj(sf, df)
        print(f"Successfully copied {f}")
    except Exception as e:
        print(f"Failed to copy {f}: {e}")
