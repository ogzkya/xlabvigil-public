import { useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowRight,
  Eye,
  EyeOff,
  ShieldCheck,
  LoaderCircle,
} from "lucide-react";
import { api } from "./api";
import { isSessionResponse } from "./responseShape";
import type { User } from "./types";
import { Brand, FormError } from "./components";
import { PRODUCT_VERSION } from "./productInfo";

export default function Auth({
  initialized,
  onLogin,
  onDemo,
}: {
  initialized: boolean;
  onLogin: (u: User) => void;
  onDemo: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [show, setShow] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget),
      password = String(form.get("password"));
    if (!initialized && password !== form.get("confirmation")) {
      setError("Parolalar eşleşmiyor.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ user: User }>(
        initialized ? "/login" : "/setup",
        "POST",
        {
          username: form.get("username"),
          password,
          name: initialized ? "" : form.get("name"),
        },
        isSessionResponse,
      );
      onLogin(result.user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-top">
        <Brand />
        <span>Kurumsal tehdit ve risk incelemesi</span>
      </div>
      <section className="auth-card">
        <div className="auth-icon">
          <ShieldCheck size={26} />
        </div>
        <h1>
          {initialized ? "Tekrar hoş geldiniz." : "Vigil’e hoş geldiniz."}
        </h1>
        <p>
          {initialized
            ? "Çalışma alanınıza güvenle giriş yapın."
            : "İlk yönetici hesabınızı oluşturarak başlayın."}
        </p>
        <form onSubmit={submit}>
          {!initialized && (
            <label>
              Ad soyad
              <input
                name="name"
                autoComplete="name"
                minLength={2}
                maxLength={100}
                required
                placeholder="Adınız ve soyadınız"
              />
            </label>
          )}
          <label>
            Kullanıcı adı
            <input
              name="username"
              autoComplete="username"
              pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}"
              minLength={3}
              maxLength={64}
              required
              placeholder="kullanici.adi"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label>
            Parola
            <div className="password-field">
              <input
                name="password"
                type={show ? "text" : "password"}
                autoComplete={initialized ? "current-password" : "new-password"}
                minLength={initialized ? 1 : 12}
                maxLength={128}
                required
                placeholder={
                  initialized ? "Parolanızı girin" : "En az 12 karakter"
                }
              />
              <button
                type="button"
                className="icon-btn"
                aria-label={show ? "Parolayı gizle" : "Parolayı göster"}
                onClick={() => setShow(!show)}
              >
                {show ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          {!initialized && (
            <label>
              Parola tekrar
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                placeholder="Parolanızı tekrar girin"
              />
            </label>
          )}
          {error && <FormError>{error}</FormError>}
          <button className="btn primary full" disabled={busy}>
            {busy ? <LoaderCircle size={17} className="spin" /> : null}
            {initialized ? "Giriş yap" : "Çalışma alanını oluştur"}
            <ArrowRight size={17} />
          </button>
        </form>
        <div className="auth-separator">
          <span>Önce keşfedin</span>
        </div>
        <button className="btn secondary full" disabled={busy} onClick={onDemo}>
          Örnek çalışma alanını incele
        </button>
        <p className="auth-foot">
          XLab Vigil · {PRODUCT_VERSION}
          <br />
          AD ve diğer kaynak bağlantıları henüz etkin değil.
        </p>
      </section>
      <footer className="auth-bottom">
        XLAB VIGIL <span>Her incelemenin bir bağlamı olsun.</span>
      </footer>
    </main>
  );
}
