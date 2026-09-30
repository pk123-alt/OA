import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { enqueueSync, getPendingSyncItems, savePatient } from './db';
import type { Patient } from './types';

type NetworkStatus = 'online' | 'offline';
type PatientLanguage = 'en' | 'hi' | 'as' | 'mni' | 'lus' | 'adi';

type PatientForm = {
  id: string;
  name: string;
  phone: string;
  language: PatientLanguage | '';
  age: string;
};

const DRAFT_KEY = 'oa-patient-draft-v1';
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
  return localStorage.getItem('oa-user-id') ?? localStorage.getItem('userId') ?? localStorage.getItem('user_id') ?? 'local-worker';
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
  const [savedPatient, setSavedPatient] = useState<Patient | null>(null);

  useEffect(() => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form));
    void savePatient({
      id: form.id,
      name: form.name,
      phone: normalizePhone(form.phone),
      language: form.language,
      age: Number(form.age) || 0,
      consent: false,
      workerUserId: getWorkerUserId(),
      syncStatus: 'pending',
      createdAt: new Date().toISOString(),
    });
  }, [form]);

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
    setSavedPatient(patient);
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
            <div className="instruction-box">
              <h2>{t('patientSavedLocally')}</h2>
              <p>{t('syncNotConnected')}</p>
            </div>
            <div className="next-step-box">
              <h3>{t('consentMedicalHistory')}</h3>
              <p>{t('nextStepPlaceholder')}</p>
            </div>
            <button className="primary-button" type="button" onClick={() => { setForm(emptyForm()); setSavedPatient(null); }}>
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
            <h2>{t('newPatient')}</h2>
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