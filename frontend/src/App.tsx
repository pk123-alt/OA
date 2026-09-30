import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { predictXray } from './api/client';
import { enqueueSync, getPendingSyncItems, savePatient } from './db';
import type { Patient } from './types';

type NetworkStatus = 'online' | 'offline';
type PatientLanguage = 'en' | 'hi' | 'as' | 'mni' | 'lus' | 'adi';
type UploadStatus = 'not-uploaded' | 'uploaded' | 'failed';

type PatientForm = {
  id: string;
  name: string;
  phone: string;
  language: PatientLanguage | '';
  age: string;
};

const DRAFT_KEY = 'oa-patient-draft-v1';
const SAVED_PATIENT_KEY = 'oa-saved-patient-v1';
const HISTORY_PAGE_KEY = 'oa-history-page-v1';
const languageOptions: Array<{ value: PatientLanguage; labelKey: string }> = [
  { value: 'en', labelKey: 'languageEnglish' },
  { value: 'hi', labelKey: 'languageHindi' },
  { value: 'as', labelKey: 'languageAssamese' },
  { value: 'mni', labelKey: 'languageManipuri' },
  { value: 'lus', labelKey: 'languageMizo' },
  { value: 'adi', labelKey: 'languageNyishiAdi' },
];

const emptyForm = (): PatientForm => ({
  id: crypto.randomUUID(),
  name: '',
  phone: '',
  language: '',
  age: '',
});

function readDraft(): PatientForm {
  try {
    const saved = localStorage.getItem(DRAFT_KEY);
    return saved ? { ...emptyForm(), ...JSON.parse(saved) } : emptyForm();
  } catch {
    return emptyForm();
  }
}

function getWorkerUserId() {
  return localStorage.getItem('oa-worker-name') ?? localStorage.getItem('userId') ?? localStorage.getItem('user_id') ?? 'local-worker';
}

function readSavedPatient(): Patient | null {
  try {
    const saved = localStorage.getItem(SAVED_PATIENT_KEY);
    return saved ? JSON.parse(saved) as Patient : null;
  } catch {
    return null;
  }
}

function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
}

function LanguageSwitcher({ language, onChange }: { language: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();
  return (
    <select value={language} onChange={(event) => onChange(event.target.value)} aria-label={t('appLanguage')}>
      <option value="en">{t('languageEnglish')}</option>
      <option value="hi">{t('languageHindi')}</option>
      <option value="as">{t('languageAssamese')}</option>
      <option value="mni">{t('languageManipuri')}</option>
      <option value="lus">{t('languageMizo')}</option>
      <option value="adi">{t('languageNyishiAdi')}</option>
    </select>
  );
}

function App() {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<PatientForm>(readDraft);
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>('online');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedPatient, setSavedPatient] = useState<Patient | null>(readSavedPatient);
  const [medicalHistory, setMedicalHistory] = useState('');
  const [jointPain, setJointPain] = useState(false);
  const [painLevel, setPainLevel] = useState(0);
  const [treatmentUndergoing, setTreatmentUndergoing] = useState(false);
  const [treatmentDetails, setTreatmentDetails] = useState('');
  const [otherJointDiseasesPresent, setOtherJointDiseasesPresent] = useState(false);
  const [otherJointDiseases, setOtherJointDiseases] = useState('');
  const [previousInjury, setPreviousInjury] = useState(false);
  const [injuryDetails, setInjuryDetails] = useState('');
  const [historySaved, setHistorySaved] = useState(() => localStorage.getItem(HISTORY_PAGE_KEY) === 'uploads');
  const [xrayFileName, setXrayFileName] = useState('');
  const [xrayFile, setXrayFile] = useState<File | null>(null);
  const [xrayPreviewUrl, setXrayPreviewUrl] = useState('');
  const [eagFileName, setEagFileName] = useState('');
  const [gaitFileName, setGaitFileName] = useState('');
  const [xrayStatus, setXrayStatus] = useState<UploadStatus>('not-uploaded');
  const [eagStatus, setEagStatus] = useState<UploadStatus>('not-uploaded');
  const [gaitStatus, setGaitStatus] = useState<UploadStatus>('not-uploaded');
  const [eagSamples, setEagSamples] = useState<number[]>([]);
  const [uploadError, setUploadError] = useState('');
  const [prediction, setPrediction] = useState<{ severity: string; confidence: number } | null>(null);
  const [isPredicting, setIsPredicting] = useState(false);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    void savePatient({
      id: form.id,
      name: form.name,
      phone: normalizePhone(form.phone),
      language: form.language,
      age: Number(form.age) || 0,
      medicalHistory: '',
      jointPain: false,
      painLevel: 0,
      treatmentUndergoing: false,
      treatmentDetails: '',
      otherJointDiseasesPresent: false,
      otherJointDiseases: '',
      previousInjury: false,
      injuryDetails: '',
      consent: false,
      workerUserId: getWorkerUserId(),
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    });
  }, [form]);

  useEffect(() => {
    if (!savedPatient || historySaved) return;
    void savePatient({
      ...savedPatient,
      medicalHistory: medicalHistory.trim(),
      jointPain,
      painLevel: jointPain ? painLevel : 0,
      treatmentUndergoing,
      treatmentDetails: treatmentUndergoing ? treatmentDetails.trim() : '',
      otherJointDiseasesPresent,
      otherJointDiseases: otherJointDiseasesPresent ? otherJointDiseases.trim() : '',
      previousInjury,
      injuryDetails: previousInjury ? injuryDetails.trim() : '',
    });
  }, [savedPatient, historySaved, medicalHistory, jointPain, painLevel, treatmentUndergoing, treatmentDetails, otherJointDiseasesPresent, otherJointDiseases, previousInjury, injuryDetails]);

  useEffect(() => {
    const updateNetworkStatus = () => setNetworkStatus(navigator.onLine ? 'online' : 'offline');
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
    void getPendingSyncItems().then((items) => setPendingSyncCount(items.length));
    return () => {
      window.removeEventListener('online', updateNetworkStatus);
      window.removeEventListener('offline', updateNetworkStatus);
    };
  }, []);

  const changeAppLanguage = (language: string) => {
    localStorage.setItem('oa-language', language);
    void i18n.changeLanguage(language);
  };

  const updateForm = (changes: Partial<PatientForm>) => {
    setForm((current) => ({ ...current, ...changes }));
    setErrors({});
  };

  const validate = () => {
    const nextErrors: Record<string, string> = {};
    const phone = normalizePhone(form.phone);
    const age = Number(form.age);

    if (!form.name.trim()) nextErrors.name = t('patientNameRequired');
    if (!/^[6-9]\d{9}$/.test(phone)) nextErrors.phone = t('phoneError');
    if (!form.language) nextErrors.language = t('languageRequired');
    if (!Number.isInteger(age) || age < 1 || age > 120) nextErrors.age = t('ageError');
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const saveAndContinue = async () => {
    if (!validate()) return;

    const patient: Patient = {
      id: form.id,
      name: form.name.trim(),
      phone: normalizePhone(form.phone),
      language: form.language,
      age: Number(form.age),
      medicalHistory: '',
      jointPain: false,
      painLevel: 0,
      treatmentUndergoing: false,
      treatmentDetails: '',
      otherJointDiseasesPresent: false,
      otherJointDiseases: '',
      previousInjury: false,
      injuryDetails: '',
      consent: false,
      workerUserId: getWorkerUserId(),
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    };

    await savePatient(patient);
    await enqueueSync({
      recordType: 'patient',
      recordId: patient.id,
      payload: patient,
      createdAt: patient.createdAt,
    });
    setPendingSyncCount((current) => current + 1);
    localStorage.setItem(SAVED_PATIENT_KEY, JSON.stringify(patient));
    setSavedPatient(patient);
  };

  const saveHistory = async () => {
    if (!savedPatient) return;
    if (treatmentUndergoing && !treatmentDetails.trim()) return setUploadError(t('treatmentDetailsRequired'));
    if (otherJointDiseasesPresent && !otherJointDiseases.trim()) return setUploadError(t('otherJointDiseasesRequired'));
    if (previousInjury && !injuryDetails.trim()) return setUploadError(t('injuryDetailsRequired'));
    const patient = {
      ...savedPatient,
      medicalHistory: medicalHistory.trim(),
      jointPain,
      painLevel: jointPain ? painLevel : 0,
      treatmentUndergoing,
      treatmentDetails: treatmentDetails.trim(),
      otherJointDiseasesPresent,
      otherJointDiseases: otherJointDiseasesPresent ? otherJointDiseases.trim() : '',
      previousInjury,
      injuryDetails: injuryDetails.trim(),
      syncStatus: 'pending' as const,
    };
    await savePatient(patient);
    await enqueueSync({
      recordType: 'patient',
      recordId: patient.id,
      payload: patient,
      createdAt: new Date().toISOString(),
    });
    setPendingSyncCount((current) => current + 1);
    localStorage.setItem(SAVED_PATIENT_KEY, JSON.stringify(patient));
    localStorage.setItem(HISTORY_PAGE_KEY, 'uploads');
    setSavedPatient(patient);
    setHistorySaved(true);
  };

  const handleXray = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      setXrayStatus('failed');
      setUploadError(t('xrayValidationError'));
      return;
    }
    try {
      await createImageBitmap(file);
      setXrayFile(file);
      setXrayFileName(file.name);
      setXrayPreviewUrl(URL.createObjectURL(file));
      setXrayStatus('uploaded');
    } catch {
      setXrayStatus('failed');
      setUploadError(t('xrayValidationError'));
    }
  };

  const predictOaRisk = async () => {
    if (!xrayFile) return;
    setIsPredicting(true);
    setUploadError('');
    try {
      const result = await predictXray(xrayFile);
      const confidence = Number(result.probabilities[String(result.predicted_class)] ?? 0);
      setPrediction({ severity: result.severity || result.grade_labels[String(result.predicted_class)], confidence });
    } catch {
      setUploadError(t('predictionUnavailable'));
    } finally {
      setIsPredicting(false);
    }
  };

  const handleEag = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (!/\.(csv|txt)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setEagStatus('failed');
      setUploadError(t('eagValidationError'));
      return;
    }
    const values = (await file.text()).split(/[\s,;]+/).map(Number).filter(Number.isFinite);
    if (values.length < 2) {
      setEagStatus('failed');
      setUploadError(t('eagValidationError'));
      return;
    }
    setEagFileName(file.name);
    setEagSamples(values.slice(0, 500));
    setEagStatus('uploaded');
  };

  const handleGait = (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    if (!file.type.startsWith('video/') || file.size > 100 * 1024 * 1024) {
      setGaitStatus('failed');
      setUploadError(t('gaitValidationError'));
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      if (video.duration < 10 || video.duration > 30) {
        setGaitStatus('failed');
        setUploadError(t('gaitValidationError'));
        return;
      }
      setGaitFileName(file.name);
      setGaitStatus('uploaded');
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      setGaitStatus('failed');
      setUploadError(t('gaitValidationError'));
    };
    video.src = url;
  };

  const header = (
    <header className="topbar">
      <div>
        <p className="eyebrow">{t('frontlineScreening')}</p>
        <h1>{t('appName')}</h1>
      </div>
      <div className="topbar-actions">
        <span className={`status-pill ${networkStatus}`}>{t(networkStatus)}</span>
        <LanguageSwitcher language={i18n.language} onChange={changeAppLanguage} />
      </div>
    </header>
  );

  if (savedPatient) {
    return (
      <div className="app-shell">
        {header}
        <main className="layout">
          <section className="screen stack">
            {historySaved ? (
              <>
                <div className="instruction-box">
                  <h2>{t('uploadPageTitle')}</h2>
                  <p>{t('uploadPageIntro')}</p>
                </div>
                {uploadError && <div className="message error">{uploadError}</div>}

                <label className="upload-box">
                  <span>{t('uploadXray')}</span>
                  <input type="file" accept="image/*" capture="environment" onChange={(event) => void handleXray(event.target.files?.[0])} />
                </label>
                <div className={`upload-status ${xrayStatus}`}>{t(xrayStatus)}</div>
                {xrayFileName && <div className="file-readout">{xrayFileName} <button type="button" className="text-button" onClick={() => { setXrayFileName(''); setXrayFile(null); setXrayPreviewUrl(''); setXrayStatus('not-uploaded'); setPrediction(null); }}>{t('removeReplace')}</button></div>}
                {xrayPreviewUrl && <div className="preview-wrap"><img src={xrayPreviewUrl} alt={t('xrayPreviewAlt')} /></div>}
                <button className="primary-button" type="button" onClick={() => void predictOaRisk()} disabled={!xrayFile || isPredicting}>{isPredicting ? t('predicting') : t('predictOaRisk')}</button>
                {prediction && <div className="result-card show"><strong>{prediction.severity}</strong><small>{t('riskConfidence', { confidence: (prediction.confidence * 100).toFixed(1) })}</small><p>{prediction.severity === 'Grade 0' ? t('lowerOaRisk') : t('doctorReviewAdvice')}</p></div>}

                <label className="upload-box">
                  <span>{t('uploadEag')}</span>
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => void handleEag(event.target.files?.[0])} />
                </label>
                <div className={`upload-status ${eagStatus}`}>{t(eagStatus)}</div>
                {eagFileName && <div className="file-readout">{eagFileName} <button type="button" className="text-button" onClick={() => { setEagFileName(''); setEagSamples([]); setEagStatus('not-uploaded'); }}>{t('removeReplace')}</button></div>}
                {eagSamples.length > 1 && <svg className="waveform-preview" viewBox="0 0 500 100" role="img" aria-label={t('eagPreviewAlt')}><polyline points={eagSamples.map((value, index) => `${(index / (eagSamples.length - 1)) * 500},${50 - (value / Math.max(...eagSamples.map(Math.abs), 1)) * 45}`).join(' ')} /></svg>}

                <label className="upload-box">
                  <span>{t('uploadGait')}</span>
                  <input type="file" accept="video/*" capture="environment" onChange={(event) => handleGait(event.target.files?.[0])} />
                </label>
                <small>{t('gaitGuidance')}</small>
                <div className={`upload-status ${gaitStatus}`}>{t(gaitStatus)}</div>
                {gaitFileName && <div className="file-readout">{gaitFileName} <button type="button" className="text-button" onClick={() => { setGaitFileName(''); setGaitStatus('not-uploaded'); }}>{t('removeReplace')}</button></div>}

                <div className="next-step-box">
                  <p>{t('filesSavedOnDevice')}</p>
                </div>
                <button className="primary-button" type="button" disabled={!xrayFileName && !eagFileName && !gaitFileName}>{t('continueWithFiles')}</button>
                <button className="back-btn" type="button" onClick={() => { localStorage.removeItem(HISTORY_PAGE_KEY); setHistorySaved(false); }}>{t('backToHistory')}</button>
              </>
            ) : (
              <>
            <div className="instruction-box">
              <h2>{t('patientHistoryTitle')}</h2>
              <p>{t('medicalHistoryIntro')}</p>
            </div>

            <fieldset className="choice-field">
              <legend>{t('jointPainQuestion')}</legend>
              <div className="choice-row">
                <label className="checkbox-row"><input type="radio" name="jointPain" checked={jointPain} onChange={() => setJointPain(true)} /> {t('yes')}</label>
                <label className="checkbox-row"><input type="radio" name="jointPain" checked={!jointPain} onChange={() => { setJointPain(false); setPainLevel(0); }} /> {t('no')}</label>
              </div>
            </fieldset>

            {jointPain && (
              <label className="field">
                <span>{t('painLevelLabel')}: {painLevel}/10</span>
                <input type="range" min="0" max="10" step="1" value={painLevel} onChange={(event) => setPainLevel(Number(event.target.value))} />
              </label>
            )}

            <fieldset className="choice-field">
              <legend>{t('treatmentQuestion')}</legend>
              <div className="choice-row">
                <label className="checkbox-row"><input type="radio" name="treatment" checked={treatmentUndergoing} onChange={() => setTreatmentUndergoing(true)} /> {t('yes')}</label>
                <label className="checkbox-row"><input type="radio" name="treatment" checked={!treatmentUndergoing} onChange={() => { setTreatmentUndergoing(false); setTreatmentDetails(''); }} /> {t('no')}</label>
              </div>
            </fieldset>

            {treatmentUndergoing && (
              <label className="field">
                <span>{t('treatmentDetailsLabel')}</span>
                <textarea value={treatmentDetails} onChange={(event) => setTreatmentDetails(event.target.value)} rows={3} placeholder={t('treatmentDetailsPlaceholder')} />
              </label>
            )}

            <label className="field">
              <span>{t('otherJointDiseasesLabel')}</span>
              <div className="choice-row">
                <label className="checkbox-row"><input type="radio" name="otherJointDiseases" checked={otherJointDiseasesPresent} onChange={() => setOtherJointDiseasesPresent(true)} /> {t('yes')}</label>
                <label className="checkbox-row"><input type="radio" name="otherJointDiseases" checked={!otherJointDiseasesPresent} onChange={() => { setOtherJointDiseasesPresent(false); setOtherJointDiseases(''); }} /> {t('no')}</label>
              </div>
            </label>
            {otherJointDiseasesPresent && <label className="field"><span>{t('otherJointDiseasesDetailsLabel')}</span><textarea value={otherJointDiseases} onChange={(event) => setOtherJointDiseases(event.target.value)} rows={3} placeholder={t('otherJointDiseasesPlaceholder')} /></label>}

            <label className="field">
              <span>{t('medicalHistoryLabel')}</span>
              <textarea value={medicalHistory} onChange={(event) => setMedicalHistory(event.target.value)} rows={4} placeholder={t('medicalHistoryPlaceholder')} />
            </label>

            <label className="checkbox-row">
              <input type="checkbox" checked={previousInjury} onChange={(event) => setPreviousInjury(event.target.checked)} />
              <span>{t('previousInjuryLabel')}</span>
            </label>

            {previousInjury && (
              <label className="field">
                <span>{t('injuryDetailsLabel')}</span>
                <textarea value={injuryDetails} onChange={(event) => setInjuryDetails(event.target.value)} rows={4} placeholder={t('injuryDetailsPlaceholder')} />
              </label>
            )}

            {uploadError && <div className="message error">{uploadError}</div>}
            <button className="primary-button" type="button" onClick={() => void saveHistory()}>{t('next')}</button>
            <div className="next-step-box">
              <p>{t('savedOnDevice')}</p>
            </div>
              </>
            )}
            <button className="primary-button" type="button" onClick={() => { localStorage.removeItem(SAVED_PATIENT_KEY); localStorage.removeItem(HISTORY_PAGE_KEY); setForm(emptyForm()); setSavedPatient(null); setHistorySaved(false); setXrayFileName(''); setXrayFile(null); setXrayPreviewUrl(''); setPrediction(null); }}>
              {t('addAnotherPatient')}
            </button>
            <small className="screen-footer">{t('screeningAidOnly')}</small>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {header}
      <main className="layout">
        <section className="screen stack">
          <div className="instruction-box">
            <h2>{t('patientDetailsTitle')}</h2>
            <p>{t('patientFormIntro')}</p>
          </div>

          <label className="field">
            <span>{t('patientNameLabel')}</span>
            <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} autoComplete="name" />
            {errors.name && <small className="field-error">{errors.name}</small>}
          </label>

          <label className="field">
            <span>{t('patientPhoneLabel')}</span>
            <input type="tel" inputMode="numeric" value={form.phone} onChange={(event) => updateForm({ phone: event.target.value })} autoComplete="tel" />
            {errors.phone && <small className="field-error">{errors.phone}</small>}
          </label>

          <label className="field">
            <span>{t('patientLanguageLabel')}</span>
            <select value={form.language} onChange={(event) => updateForm({ language: event.target.value as PatientLanguage })}>
              <option value="">{t('choosePatientLanguage')}</option>
              {languageOptions.map((option) => (
                <option value={option.value} key={option.value}>{t(option.labelKey)}</option>
              ))}
            </select>
            {errors.language && <small className="field-error">{errors.language}</small>}
          </label>

          <label className="field">
            <span>{t('patientAgeLabel')}</span>
            <input type="number" inputMode="numeric" min="1" max="120" step="1" value={form.age} onChange={(event) => updateForm({ age: event.target.value })} />
            {errors.age && <small className="field-error">{errors.age}</small>}
          </label>

          <button className="primary-button" type="button" onClick={() => void saveAndContinue()}>{t('saveAndContinue')}</button>
          <p className="screen-footer">{t('screeningAidOnly')} · {t('draftAutosave')} · {t('pendingSync', { count: pendingSyncCount })}</p>
        </section>
      </main>
    </div>
  );
}

export default App;