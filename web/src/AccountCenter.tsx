import { Fingerprint } from "lucide-react";
import { Badge } from "./components";
import { accountSessionStatusTone } from "./design";
import PasswordChange from "./PasswordChange";
import { roleLabels } from "./types";
import type { User } from "./types";

export default function AccountCenter({
  user,
  demo,
  onSessionExpired,
}: {
  user: User;
  demo: boolean;
  onSessionExpired: () => void;
}) {
  return (
    <div className="settings-grid account-grid">
      <section className="panel settings-card">
        <Fingerprint size={24} />
        <h2>Vigil hesabınız</h2>
        <p>Bu hesap yalnızca XLab Vigil yerel çalışma alanında kullanılır.</p>
        <div className="settings-row">
          <span>Görünen ad</span>
          <strong>{user.name}</strong>
        </div>
        <div className="settings-row">
          <span>Kullanıcı adı</span>
          <strong>{user.username}</strong>
        </div>
        <div className="settings-row">
          <span>Rol</span>
          <strong>{roleLabels[user.role]}</strong>
        </div>
        <div className="settings-row">
          <span>İkinci doğrulama</span>
          <Badge tone={accountSessionStatusTone.warning}>Henüz bağlı değil</Badge>
        </div>
        {demo ? (
          <div className="info-strip account-notice">
            Örnek kullanıcı salt okunurdur; hesap ve parola işlemleri kapalıdır.
          </div>
        ) : (
          <PasswordChange onSessionExpired={onSessionExpired} />
        )}
      </section>
      <section className="panel settings-card">
        <h2>Oturum güvenliği</h2>
        <p>
          Parola değişikliğinde mevcut tarayıcı oturumu açık kalır. Bu hesaba ait
          diğer oturumlar kapatılır.
        </p>
        <div className="settings-row">
          <span>Oturum süresi</span>
          <strong>En fazla 8 saat</strong>
        </div>
        <div className="settings-row">
          <span>Çok faktörlü giriş</span>
          <Badge tone={accountSessionStatusTone.warning}>Etkin değil</Badge>
        </div>
        <div className="settings-row">
          <span>Kurum dizini</span>
          <Badge tone={accountSessionStatusTone.neutral}>Bağlı değil</Badge>
        </div>
      </section>
    </div>
  );
}
