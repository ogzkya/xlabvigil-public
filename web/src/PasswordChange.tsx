import { useState } from "react";
import type { FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { api, ApiError } from "./api";
import { FormError, SuccessNotice } from "./components";
import FormModal from "./FormModal";
import { useAlive } from "./resource";

export default function PasswordChange({
  onSessionExpired,
}: {
  onSessionExpired: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useAlive();

  function resetForm() {
    setOpen(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmation("");
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (newPassword !== confirmation) {
      setError("Yeni parola ve tekrar alanları eşleşmiyor.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api<{ ok: boolean }>("/session/password", "POST", {
        currentPassword,
        newPassword,
      });
      if (!alive.current) return;
      resetForm();
      setNotice("Parolanız değiştirildi. Diğer açık oturumlar kapatıldı.");
    } catch (err) {
      if (!alive.current) return;
      setError((err as Error).message);
      if (err instanceof ApiError && err.status === 401) onSessionExpired();
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  return (
    <div className="password-change">
      <button
        className="btn secondary"
        onClick={() => {
          setNotice("");
          setOpen(true);
        }}
      >
        <KeyRound size={16} /> Parolayı değiştir
      </button>
      {notice && <SuccessNotice appearance="inline">{notice}</SuccessNotice>}
      {open && (
        <FormModal
          title="Parolayı değiştir"
          subtitle="Bu tarayıcıdaki oturum açık kalır; diğer Vigil oturumları kapatılır."
          onClose={resetForm}
          closeDisabled={busy}
        >
          {(requestClose) => (
          <form className="editor-form" onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <label>
                Mevcut parola
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  maxLength={128}
                  required
                />
              </label>
              <label>
                Yeni parola
                <input
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
                <small className="field-help">12–128 bayt olmalı ve mevcut paroladan farklı olmalı.</small>
              </label>
              <label>
                Yeni parola tekrar
                <input
                  type="password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  required
                />
              </label>
              {error && <FormError>{error}</FormError>}
            </fieldset>
            <div className="modal-actions">
              <button className="btn secondary" type="button" onClick={requestClose} disabled={busy}>
                Vazgeç
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "Kaydediliyor…" : "Parolayı güncelle"}
              </button>
            </div>
          </form>
          )}
        </FormModal>
      )}
    </div>
  );
}
