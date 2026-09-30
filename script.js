const API_URL = 'http://127.0.0.1:8000/predict';
const imageInput = document.getElementById('imageUpload');
const uploadForm = document.getElementById('uploadForm');
const predictBtn = document.getElementById('predictBtn');
const previewImage = document.getElementById('previewImage');
const previewPlaceholder = document.getElementById('previewPlaceholder');
const severityLabel = document.getElementById('severityLabel');
const status = document.getElementById('status');
const probabilityList = document.getElementById('probabilityList');

imageInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    previewImage.src = e.target.result;
    previewImage.hidden = false;
    previewPlaceholder.hidden = true;
  };
  reader.readAsDataURL(file);
});

uploadForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const file = imageInput.files[0];
  if (!file) {
    showStatus('Please choose an image first.', 'error');
    return;
  }

  predictBtn.disabled = true;
  predictBtn.textContent = 'Predicting...';
  showStatus('Uploading image and predicting severity...', '');

  const formData = new FormData();
  formData.append('file', file);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || 'Prediction failed.');
    }

    const label = data.severity || `Grade ${data.predicted_class}`;
    severityLabel.textContent = label;

    const probabilities = Object.entries(data.probabilities || {}).map(([key, value]) => ({
      grade: data.grade_labels?.[key] || `Grade ${key}`,
      value: Number(value),
      key,
    }));

    probabilityList.innerHTML = probabilities
      .map(({ grade, value }) => {
        const percent = Math.round(value * 100);
        return `
          <div class="probability-row">
            <span class="probability-label">${grade}</span>
            <div class="probability-bar">
              <div class="probability-fill" style="width: ${percent}%"></div>
            </div>
            <span class="probability-value">${percent}%</span>
          </div>
        `;
      })
      .join('');

    showStatus('Prediction successful.', 'success');
  } catch (error) {
    showStatus(error.message || 'Something went wrong.', 'error');
    severityLabel.textContent = '--';
    probabilityList.innerHTML = '<div class="probability-row empty">Upload an image to see results</div>';
  } finally {
    predictBtn.disabled = false;
    predictBtn.textContent = 'Predict Severity';
  }
});

function showStatus(message, type) {
  status.textContent = message;
  status.className = 'status';

  if (type) {
    status.classList.add(type);
  } else {
    status.classList.add('hidden');
  }

  if (message) {
    status.classList.remove('hidden');
  }
}
