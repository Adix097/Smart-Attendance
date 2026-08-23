# InsightFace face-recognition feasibility spike

This isolated experiment verifies local CPU-based InsightFace face detection,
embedding extraction, and small-gallery matching. It is not attendance logic,
tracking, an API, or a production component.

The experiment keeps embeddings in memory only. It does not write face images,
embeddings, model files, or generated inference output into the repository.

## Temporary environment

Use a separate virtual environment outside the repository so the existing
`ai-service/.venv` remains untouched. The commands below use Python 3.14 first:

```powershell
$env:SPIKE_VENV = "$env:USERPROFILE\.venvs\smart-attendance-insightface-spike"
py -3.14 -m venv $env:SPIKE_VENV
& "$env:SPIKE_VENV\Scripts\python.exe" -m pip install --upgrade pip
```

If Python 3.14 dependency resolution fails, create the same temporary
environment with Python 3.12 and record that change in the experiment results.

## Install dependencies

From the repository root:

```powershell
$env:SPIKE_VENV = "$env:USERPROFILE\.venvs\smart-attendance-insightface-spike"
& "$env:SPIKE_VENV\Scripts\python.exe" -m pip install -r ai-service\spikes\face-recognition\requirements.txt
```

The dependency set is intentionally limited to:

- `insightface==1.0.1`
- CPU `onnxruntime`
- NumPy, ONNX, OpenCV, SciPy, scikit-image, tqdm, and requests

No GUI extras, GPU runtime, tracking framework, or other computer-vision
framework is required.

## Model download and cache

The first model initialization downloads the `buffalo_l` model pack
(approximately 326 MB) from InsightFace's configured model source. It is
cached outside the repository under:

```text
%USERPROFILE%\.insightface\models\buffalo_l\
```

The cache must not be copied into Git. A network connection is required for the
first initialization.

## Image layout

Prepare only consented demo images. Do not place biometric data in a tracked
repository directory.

Enrollment images must have one directory per person:

```text
C:\path\to\enrollment\
  person-a\
    image-1.jpg
    image-2.jpg
  person-b\
    image-1.jpg
    image-2.jpg
```

Each enrollment image must contain exactly one detectable face. Images with
zero or multiple faces are rejected. Use multiple poses or lighting conditions
per person where possible.

Test images may be directly in the test directory or nested below it:

```text
C:\path\to\test\
  clear-person-a.jpg
  unknown-person.jpg
  occluded\
    person-b-side-angle.jpg
```

Test images can contain multiple faces. Every detected face is reported
separately.

## Initialization test

This initializes `buffalo_l` with the CPU execution provider without reading
any images:

```powershell
$env:SPIKE_VENV = "$env:USERPROFILE\.venvs\smart-attendance-insightface-spike"
& "$env:SPIKE_VENV\Scripts\python.exe" `
  ai-service\spikes\face-recognition\run.py `
  --init-only
```

## Run the experiment

```powershell
$env:SPIKE_VENV = "$env:USERPROFILE\.venvs\smart-attendance-insightface-spike"
& "$env:SPIKE_VENV\Scripts\python.exe" `
  ai-service\spikes\face-recognition\run.py `
  --enrollment-dir C:\path\to\enrollment `
  --test-dir C:\path\to\test
```

The default exploratory acceptance threshold is cosine similarity `0.45`.
Change it only for an explicitly recorded experiment:

```powershell
& "$env:SPIKE_VENV\Scripts\python.exe" `
  ai-service\spikes\face-recognition\run.py `
  --enrollment-dir C:\path\to\enrollment `
  --test-dir C:\path\to\test `
  --threshold 0.50
```

The output reports model providers, initialization time, per-image processing
time, detected face counts, best identity match, cosine similarity, and an
`accepted` or `unknown` result. Cosine similarity is not a probability or
confidence percentage. The threshold is not calibrated by this script, and the
script does not claim recognition accuracy.

## Privacy and licensing

Use only consented demo faces and handle the images as biometric data. Delete
the temporary enrollment/test images and model cache when the experiment is
complete.

The InsightFace Python library code is MIT licensed, but the pretrained
`buffalo_l` model pack is provided for non-commercial research purposes only.
It is not approved by this project for commercial or institutional production
deployment. Production use requires a suitable model license or a replacement
model with appropriate terms.

## Remove the temporary environment

After the experiment, remove the external virtual environment:

```powershell
$env:SPIKE_VENV = "$env:USERPROFILE\.venvs\smart-attendance-insightface-spike"
Remove-Item -Recurse -Force $env:SPIKE_VENV
```

If the model cache is also no longer needed:

```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.insightface\models\buffalo_l"
```
