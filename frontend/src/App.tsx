import { useEffect, useMemo, useState } from 'react';
import './App.css';
import { healthCheck, predictXray } from './api/client';
import { enqueueSync, getPendingSyncItems, getScreenings, savePatient, saveScreening } from './db';
import type { Patient, Screening } from './types';

type Role = 'worker' | 'doctor';
type ModuleStatus = 'pending' | 'completed' | 'unavailable';
type StepIndex = 0 | 1 | 2 | 3 | 4;

interface SessionData {
  role: Role;
  patientName: string;
  age: string;
  pain: number;
  consent: boolean;
  step: StepIndex;
  resultSummary: string;
  confidence: number;
  savedAt: string;
  xrayStatus: ModuleStatus;
  supportingNotes: string;
  otherDataFiles: string[];
  gaitVideoName: string;
  eagSignalName: string;
}

const STORAGE_KEY = 'oa-field-session-v1';
const SESSION_TIMEOUT_MS = 20 * 60 * 1000;

const defaultSession: SessionData = {
  role: 'worker',
  patientName: '',
  age: '',
  pain: 3,
  consent: false,
  step: 0,
  resultSummary: '',
  confidence: 0,
  savedAt: new Date().toISOString(),
  xrayStatus: 'pending',
  supportingNotes: '',
  otherDataFiles: [],
  gaitVideoName: '',
  eagSignalName: '',
};

function App() {
  const [session, setSession] = useState<SessionData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...defaultSession, ...JSON.parse(saved) } : defaultSession;
    } catch {
      return defaultSession;
    }
  });
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline'>('online');
  const [xrayAvailable, setXrayAvailable] = useState<boolean | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState('');
  const [error, setError] = useState('');
  const [currentPatient, setCurrentPatient] = useState<Patient | null>(null);

  const hasExpiredSession = Date.now() - new Date(session.savedAt).getTime() > SESSION_TIMEOUT_MS;

  const moduleCards = useMemo(() => {
    const xrayStatus: ModuleStatus = xrayAvailable === false ? 'unavailable' : session.resultSummary ? 'completed' : 'pending';
    const gaitStatus: ModuleStatus = session.gaitVideoName ? 'completed' : 'pending';
    const eagStatus: ModuleStatus = session.eagSignalName ? 'completed' : 'pending';

    return [
      { name: 'X-ray', status: xrayStatus, detail: xrayAvailable === false ? 'Not available yet' : session.resultSummary ? 'Completed' : 'Pending' },
      { name: 'Gait video', status: gaitStatus, detail: session.gaitVideoName ? 'Uploaded for review' : 'Upload video' },
      { name: 'EAG signal', status: eagStatus, detail: session.eagSignalName ? 'Uploaded for review' : 'Upload signal data' },
      { name: 'Other notes', status: session.supportingNotes ? 'completed' : 'pending', detail: session.supportingNotes ? 'Added' : 'Add notes' },
    ];
  }, [session.resultSummary, xrayAvailable, session.gaitVideoName, session.eagSignalName, session.supportingNotes]);

  const updateSession = (changes: Partial<SessionData>) => {
    setSession((current) => ({ ...current, ...changes, savedAt: new Date().toISOString() }));
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    const syncConnectionState = () => setNetworkStatus(navigator.onLine ? 'online' : 'offline');
    syncConnectionState();
    window.addEventListener('online', syncConnectionState);
    window.addEventListener('offline', syncConnectionState);

    const loadSavedData = async () => {
      try {
        const [savedScreenings, pendingItems] = await Promise.all([getScreenings(), getPendingSyncItems()]);
        setScreenings(savedScreenings);
        setPendingSyncCount(pendingItems.length);
      } catch {
        setError('Saved work could not be loaded.');
      }
    };

    void loadSavedData();
    void healthCheck()
      .then(() => setXrayAvailable(true))
      .catch(() => setXrayAvailable(false));

    return () => {
      window.removeEventListener('online', syncConnectionState);
      window.removeEventListener('offline', syncConnectionState);
    };
  }, []);

  useEffect(() => {
    if (session.patientName.trim() && session.consent) {
      void savePatient({
        id: crypto.randomUUID(),
        name: session.patientName.trim(),
        age: Number(session.age) || 0,
        consent: true,
        createdAt: new Date().toISOString(),
      }).catch(() => setError('Consent was saved locally, but the data could not be stored.'));
    }
  }, [session.patientName, session.age, session.consent]);

  const speakText = (text: string) => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'en-IN';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  };

  const goBack = () => {
    setError('');
    setSession((current) => ({
      ...current,
      step: current.step > 0 ? ((current.step - 1) as StepIndex) : 0,
      savedAt: new Date().toISOString(),
    }));
  };

  const handleConsentContinue = async () => {
    if (!session.patientName.trim()) {
      setError('Please add the patient name before continuing.');
      return;
    }
    if (!session.consent) {
      setError('Consent is required before any screening can begin.');
      return;
    }

    const patient: Patient = {
      id: crypto.randomUUID(),
      name: session.patientName.trim(),
      age: Number(session.age) || 0,
      consent: true,
      createdAt: new Date().toISOString(),
    };

    await savePatient(patient);
    setCurrentPatient(patient);
    setError('');
    updateSession({ step: 1 });
  };

  const handlePrediction = async () => {
    if (!selectedFile) {
      setError('Please select an X-ray image first.');
      return;
    }

    if (!currentPatient) {
      setError('Please save the screening details before checking the X-ray.');
      return;
    }

    if (xrayAvailable === false) {
      setError('X-ray check is not available yet. Please try again later or save this work and continue when the service is back.');
      return;
    }

    setIsBusy(true);
    setBusyMessage('Checking X-ray...');
    setError('');

    const screeningId = crypto.randomUUID();
    const screeningBase: Screening = {
      id: screeningId,
      patientId: currentPatient.id,
      type: 'xray',
      status: networkStatus === 'online' ? 'queued' : 'offline',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      result: { severity: 'Checking', mode: 'xray' },
    };

    try {
      const prediction = await predictXray(selectedFile);
      const severity = prediction.severity || prediction.grade_labels[String(prediction.predicted_class)] || `Grade ${prediction.predicted_class}`;
      const confidenceValue = Number(prediction.probabilities[String(prediction.predicted_class)] ?? 0);
      const nextSummary = `${severity}`;

      const savedScreening: Screening = {
        ...screeningBase,
        status: networkStatus === 'online' ? 'synced' : 'offline',
        result: {
          severity,
          predictedClass: prediction.predicted_class,
          confidence: confidenceValue,
          probabilities: prediction.probabilities,
          mode: 'xray',
          note: confidenceValue < 0.6 ? 'Low confidence. Clinic review is advised.' : 'Preliminary screening result.',
        },
      };

      await saveScreening(savedScreening);
      if (!navigator.onLine) {
        await enqueueSync({
          screeningId: savedScreening.id,
          payload: savedScreening,
          createdAt: new Date().toISOString(),
        });
      }

      setScreenings((current) => [savedScreening, ...current]);
      setPendingSyncCount((current) => current + (navigator.onLine ? 0 : 1));
      setSession((current) => ({ ...current, resultSummary: nextSummary, confidence: confidenceValue, xrayStatus: 'completed', step: 4, savedAt: new Date().toISOString() }));
      setError('');
      setBusyMessage('');
    } catch {
      const message = 'We could not read the X-ray. Please lay the image flat and try again. If it still fails, save the work and try later.';
      setError(message);
      setBusyMessage('');
      setSession((current) => ({ ...current, resultSummary: 'Not available yet', xrayStatus: 'unavailable', savedAt: new Date().toISOString() }));
    } finally {
      setIsBusy(false);
    }
  };

  const readyForDoctorDashboard = screenings.length > 0 || pendingSyncCount > 0;

  const doctorActionMessage = (() => {
    if (!session.resultSummary || session.resultSummary === 'Not available yet') {
      return 'No result is available yet. Please try the X-ray again or speak to the clinic team later.';
    }

    const normalized = session.resultSummary.toLowerCase();
    if (normalized.includes('grade 0') || normalized.includes('grade 1') && session.confidence < 0.6) {
      return 'You probably do not need to meet a doctor today. Keep an eye on the pain and come back if it gets worse.';
    }

    if (normalized.includes('grade 1') || normalized.includes('grade 2') || normalized.includes('grade')) {
      return 'Please meet a doctor soon for a check-up. This screening suggests you should talk with a clinic or doctor.';
    }

    return 'Please meet a doctor soon for a check-up.';
  })();

  const renderWorkerView = () => {
    const stepName = ['Consent', 'Pain check', 'Module status', 'X-ray', 'Result'][session.step] ?? 'Result';
    const stepCount = (session.step + 1) as number;
    const stepLabel = `Step ${stepCount} of 5`;

    return (
      <div className="screen">
        <div className="progress-row">
          <button className="back-btn" type="button" onClick={goBack}>← Back</button>
          <div className="step-pill">{stepLabel}</div>
        </div>

        {hasExpiredSession && (
          <div className="info-banner">Session saved. The worker data is still safe on this phone.</div>
        )}

        {error && <div className="message error">{error}</div>}

        {session.step === 0 && (
          <div className="stack">
            <div className="instruction-box">
              <h2>Consent and basic details</h2>
              <p>Only use this for a quick screening check. This is not a medical diagnosis.</p>
              <button className="icon-button small" type="button" onClick={() => speakText('This is a screening tool, not a diagnosis. Please confirm consent before proceeding.')}>🔊 Listen</button>
            </div>

            <label className="field">
              <span>Patient name</span>
              <input value={session.patientName} onChange={(event) => updateSession({ patientName: event.target.value })} placeholder="Enter name" />
            </label>

            <label className="field">
              <span>Age</span>
              <input value={session.age} onChange={(event) => updateSession({ age: event.target.value })} inputMode="numeric" placeholder="35" />
            </label>

            <label className="checkbox-row">
              <input type="checkbox" checked={session.consent} onChange={(event) => updateSession({ consent: event.target.checked })} />
              <span>I confirm consent for screening.</span>
            </label>

            <button className="primary-button" type="button" onClick={handleConsentContinue}>✓ Save and continue</button>
          </div>
        )}

        {session.step === 1 && (
          <div className="stack">
            <div className="instruction-box">
              <h2>Pain check</h2>
              <p>Choose the pain level that best matches the patient today.</p>
            </div>

            <label className="field">
              <span>Pain level: {session.pain}/10</span>
              <input
                type="range"
                min="0"
                max="10"
                step="1"
                value={session.pain}
                onChange={(event) => updateSession({ pain: Number(event.target.value) })}
              />
            </label>

            <div className="scale-row">
              <span>0</span>
              <span>5</span>
              <span>10</span>
            </div>

            <button className="primary-button" type="button" onClick={() => updateSession({ step: 2 as StepIndex })}>✓ Continue</button>
          </div>
        )}

        {session.step === 2 && (
          <div className="stack">
            <div className="instruction-box">
              <h2>Case intake</h2>
              <p>Upload the main case files for review. All relevant clinical inputs are important and should be captured together.</p>
            </div>

            <div className="module-list">
              {moduleCards.map((item) => (
                <div key={item.name} className={`module-card ${item.status}`}>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </div>
                  <span className="status-tag">{item.status}</span>
                </div>
              ))}
            </div>

            <button className="primary-button" type="button" onClick={() => updateSession({ step: 3 as StepIndex })}>✓ Continue</button>
          </div>
        )}

        {session.step === 3 && (
          <div className="stack">
            <div className="instruction-box">
              <h2>Case files</h2>
              <p>Upload the X-ray, gait video, EAG signal file, and any other relevant files for the patient case.</p>
              <button className="icon-button small" type="button" onClick={() => speakText('Upload the patient case files, including the X-ray, gait video, and EAG signal data.')}>🔊 Listen</button>
            </div>

            {xrayAvailable === false ? (
              <div className="not-available-box">X-ray service is not available yet. Please save this work and try again later.</div>
            ) : (
              <>
                <label className="upload-box">
                  <span>Choose X-ray image</span>
                  <input type="file" accept="image/*" onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setSelectedFile(file);
                    if (file) {
                      setPreviewUrl(URL.createObjectURL(file));
                    }
                  }} />
                </label>

                {previewUrl && (
                  <div className="preview-wrap">
                    <img src={previewUrl} alt="Selected X-ray" />
                  </div>
                )}

                <div className="optional-panel">
                  <h3>Case files</h3>
                  <p>Attach all relevant case files together so they can be reviewed as one patient record.</p>

                  <label className="upload-box small-upload">
                    <span>Gait video</span>
                    <input
                      type="file"
                      accept="video/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        updateSession({ gaitVideoName: file ? file.name : '' });
                      }}
                    />
                  </label>
                  {session.gaitVideoName && <div className="file-readout">Selected: {session.gaitVideoName}</div>}

                  <label className="upload-box small-upload">
                    <span>EAG signal file</span>
                    <input
                      type="file"
                      accept=".csv,.txt,.xlsx,.xls,.json,.dat"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        updateSession({ eagSignalName: file ? file.name : '' });
                      }}
                    />
                  </label>
                  {session.eagSignalName && <div className="file-readout">Selected: {session.eagSignalName}</div>}

                  <label className="upload-box small-upload">
                    <span>Other data</span>
                    <input
                      type="file"
                      accept="image/*,.pdf,.doc,.docx"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? []);
                        const filenames = files.map((file) => file.name);
                        updateSession({ otherDataFiles: filenames });
                      }}
                    />
                  </label>

                  {session.otherDataFiles.length > 0 && (
                    <ul className="file-list">
                      {session.otherDataFiles.map((fileName) => (
                        <li key={fileName}>{fileName}</li>
                      ))}
                    </ul>
                  )}

                  <label className="field">
                    <span>Extra notes</span>
                    <textarea
                      value={session.supportingNotes}
                      onChange={(event) => updateSession({ supportingNotes: event.target.value })}
                      rows={3}
                      placeholder="Add brief notes such as gait changes, swelling, previous injury, pain pattern, or clinician comments."
                    />
                  </label>
                </div>

                <button className="primary-button" type="button" onClick={handlePrediction} disabled={isBusy}>
                  {isBusy ? busyMessage || 'Checking X-ray...' : '✓ Check X-ray'}
                </button>
              </>
            )}

            {busyMessage && <div className="message info">{busyMessage}</div>}
          </div>
        )}

        {session.step === 4 && (
          <div className="stack">
            <div className="instruction-box">
              <h2>Screening result</h2>
              <p>Use this as a preliminary guide only. It is not a diagnosis.</p>
              <button className="icon-button small" type="button" onClick={() => speakText(`Result is ${session.resultSummary || 'not available yet'}. Follow the clinic referral advice.`)}>🔊 Listen</button>
            </div>

            <div className={`result-card ${session.resultSummary ? 'show' : 'pending'}`}>
              <div className="result-icon">{session.resultSummary ? '⚠️' : '•'}</div>
              <div>
                <strong>{session.resultSummary || 'Not available yet'}</strong>
                <small>{session.confidence ? `${(session.confidence * 100).toFixed(1)}% confidence` : 'Waiting for an image check'}</small>
              </div>
            </div>

            <div className="next-step-box">
              <h3>Should they meet a doctor?</h3>
              <p>{doctorActionMessage}</p>
            </div>

            <button className="primary-button" type="button" onClick={() => updateSession({ step: 0 as StepIndex, resultSummary: '', confidence: 0, xrayStatus: 'pending' })}>✓ Start new screening</button>
          </div>
        )}

        <div className="screen-footer">
          <small>{stepName}</small>
          <small>Autosaved on this phone</small>
        </div>
      </div>
    );
  };

  const renderDoctorView = () => (
    <div className="screen">
      <div className="progress-row">
        <div className="step-pill">Doctor / Admin</div>
      </div>

      <div className="stats-grid">
        <div className="stat-box">
          <span>Screenings</span>
          <strong>{screenings.length}</strong>
        </div>
        <div className="stat-box">
          <span>Queued</span>
          <strong>{pendingSyncCount}</strong>
        </div>
        <div className="stat-box">
          <span>Network</span>
          <strong>{networkStatus}</strong>
        </div>
        <div className="stat-box">
          <span>X-ray service</span>
          <strong>{xrayAvailable === false ? 'Not available' : 'Online'}</strong>
        </div>
      </div>

      {!readyForDoctorDashboard ? (
        <div className="info-banner">No screening records yet. Health workers will send their data here after consent and upload.</div>
      ) : (
        <div className="stack">
          <h3>Recent screening activity</h3>
          <div className="history-list">
            {screenings.slice(0, 10).map((screening) => (
              <div key={screening.id} className="history-item">
                <strong>{screening.result?.severity ?? 'Pending'}</strong>
                <small>{new Date(screening.createdAt).toLocaleString()}</small>
                <span>{screening.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const workerRole = session.role === 'worker';

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Frontline screening</p>
          <h1>OA Screening Aid</h1>
        </div>

        <div className="topbar-actions">
          <span className={`status-pill ${networkStatus}`}>{networkStatus}</span>
          <select
            value={session.role}
            onChange={(event) => updateSession({ role: event.target.value as Role, step: 0 as StepIndex })}
            aria-label="Select role"
          >
            <option value="worker">Health worker</option>
            <option value="doctor">Doctor / Admin</option>
          </select>
        </div>
      </header>

      <main className="layout">
        {workerRole ? renderWorkerView() : renderDoctorView()}
      </main>
    </div>
  );
}

export default App;
