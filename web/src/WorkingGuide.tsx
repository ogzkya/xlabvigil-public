import { useId } from "react";
import { ArrowRight, BookOpen, FolderKanban, UsersRound } from "lucide-react";
import { Badge } from "./components";
import { roleLabels } from "./types";
import type { Page, Status, User } from "./types";

export type WorkingGuideProps = {
  user: User;
  demo: boolean;
  status: Status | null;
  onNavigate: (page: Page) => void;
};

type GuideLink = { page: Page; label: string };

function GuideLinks({
  links,
  onNavigate,
}: {
  links: GuideLink[];
  onNavigate: (page: Page) => void;
}) {
  return (
    <div className="working-guide-actions">
      {links.map(({ page, label }) => (
        <button
          key={page}
          className="btn secondary"
          type="button"
          onClick={() => onNavigate(page)}
        >
          {label} <ArrowRight size={14} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

export default function WorkingGuide({
  user,
  demo,
  status,
  onNavigate,
}: WorkingGuideProps) {
  const headingId = useId();
  const canReview = user.role === "admin" || user.role === "analyst";
  return (
    <div className="working-guide">
      <section
        className="panel working-guide-intro"
        aria-labelledby={headingId}
      >
        <div className="working-guide-heading">
          <BookOpen size={22} aria-hidden="true" />
          <h2 id={headingId}>Vigil nasıl çalışır?</h2>
          <Badge>{demo ? "Salt okunur demo" : "Manuel inceleme"}</Badge>
        </div>
        <p>
          Vigil, kurumun varlıklarını ve insan tarafından yapılan incelemeleri
          gerekçe, sorumlu ve geçmişiyle kaydeder. Çalışmaya iki bağımsız yoldan
          başlayabilirsiniz; inceleme dosyası açmak için varlık, grup veya
          üyelik oluşturmanız gerekmez.
        </p>
        {demo && (
          <p className="working-guide-note">
            Demo ekranlarında kurgusal örnekleri gezebilirsiniz. Kayıt
            oluşturma, düzenleme ve inceleme kararları demo içinde kapalıdır.
          </p>
        )}
      </section>

      <div className="working-guide-tracks">
        <section
          className="panel working-guide-track"
          aria-labelledby={`${headingId}-memberships`}
        >
          <div className="working-guide-heading">
            <UsersRound size={21} aria-hidden="true" />
            <h3 id={`${headingId}-memberships`}>Varlık ve üyelik takibi</h3>
          </div>
          <ol className="working-guide-steps">
            <li>
              <h4>Varlıkları ve ilişkilerini kaydedin</h4>
              <p>
                Personel, hesap, cihaz, servis ve uygulama kayıtları oluşturun.
                Hesap ve cihazları ilgili personele elle bağlayın. Bu ilişkiler
                aday kimlik bilgisidir; kurum dizini tarafından doğrulanmış
                kimlik sayılmaz.
              </p>
            </li>
            <li>
              <h4>İzleme grubunun kapsamını belirleyin</h4>
              <p>
                Grubun adını, açıklamasını ve inceleme önceliğini seçin. Renk,
                ekibin hangi kaydı önce inceleyeceğini anlatır; tehdit hükmü
                vermez.
              </p>
            </li>
            <li>
              <h4>Gerekçeli ve tarihli üyeliği izleyin</h4>
              <p>
                Varlığı gruba eklerken gerekçe, sorumlu, başlangıç, bitiş ve
                inceleme tarihini yazın. İnceleme zamanı geldiğinde gerekçeyle
                devam veya kapatma kararı verin. Üyelik ve karar geçmişi kayıtta
                kalır.
              </p>
              <p>
                Listeler ve uyarılar ekranında kırmızı ve sarı üyelikleri
                doğrudan görün. Süresi dolan, inceleme tarihi gelen ve yaklaşan
                kayıtlar ile kırmızı listede etkin takip için sistem uyarıları
                oluşur. Uyarılar tüm inceleme gruplarını kapsar; kayıt kapanınca
                kalkar. Olay bildiriminin okunması bu inceleme uyarısını kapatmaz.
              </p>
            </li>
          </ol>
          {canReview && (
            <GuideLinks
              links={[
                { page: "watchlists", label: "Listeler ve uyarılar" },
                { page: "entities", label: "Varlıklar" },
                { page: "groups", label: "İzleme grupları" },
                { page: "memberships", label: "İnceleme üyelikleri" },
              ]}
              onNavigate={onNavigate}
            />
          )}
        </section>

        <section
          className="panel working-guide-track"
          aria-labelledby={`${headingId}-cases`}
        >
          <div className="working-guide-heading">
            <FolderKanban size={21} aria-hidden="true" />
            <h3 id={`${headingId}-cases`}>Olay ve dosya incelemesi</h3>
          </div>
          <ol className="working-guide-steps">
            <li>
              <h4>İncelenecek olayları aktarın</h4>
              <p>
                Yönetici kaynak profilini tanımlar ve ortak biçime
                dönüştürülmüş JSON olaylarını elle aktarır. Analist olayların
                kaynak, zaman, önem derecesi ve kimlik bağlamını inceler. Profil
                kaydetmek canlı veri toplamayı başlatmaz.
              </p>
            </li>
            <li>
              <h4>İnceleme dosyasını açın</h4>
              <p>
                Başlık, özet ve sorumlu yazarak dosya oluşturun. Olay henüz
                yoksa da dosya açabilirsiniz. Sorumlu alanı bir takip
                bilgisidir; kullanıcıya ek erişim yetkisi vermez.
              </p>
            </li>
            <li>
              <h4>Olayları ilişkilendirin ve kararı kaydedin</h4>
              <p>
                İlgili olayları gerekçeyle elle ekleyin; yanlış ilişkiyi yine
                gerekçeyle geri çekin. Not ekleyin, incelemeyi kapatın veya
                yeniden açın. Faaliyet geçmişi kimin, ne zaman, hangi
                değişikliği yaptığını gösterir.
              </p>
            </li>
          </ol>
          <p className="working-guide-note">
            Dosya işlemleri varlıkları, grupları veya üyelikleri kendiliğinden
            değiştirmez. Olaylar üyeliklere de ayrı bir insan kararıyla
            ilişkilendirilebilir.
          </p>
          {canReview && (
            <GuideLinks
              links={[
                { page: "sources", label: "Veri kaynakları" },
                { page: "events", label: "Güvenlik olayları" },
                { page: "cases", label: "İnceleme dosyaları" },
              ]}
              onNavigate={onNavigate}
            />
          )}
        </section>
      </div>

      <section
        className="panel working-guide-card"
        aria-labelledby={`${headingId}-boundaries`}
      >
        <h3 id={`${headingId}-boundaries`}>Kayıtları nasıl yorumlamalı?</h3>
        <dl className="working-guide-meaning">
          <div>
            <dt>Kimlik ve kaynak</dt>
            <dd>
              Elle girilen varlık ve olay kimlikleri aday bilgidir. Olayın
              kaynağı ve aktarım biçimi görünür kalır; eşleşme otomatik kimlik
              doğrulaması değildir.
            </dd>
          </div>
          <div>
            <dt>Renk ve önem derecesi</dt>
            <dd>
              Grup renkleri inceleme önceliğini, olayın önem derecesi ise
              aktarılmış sınıflandırmayı gösterir. Sonuç, insan incelemesiyle
              gerekçelendirilir.
            </dd>
          </div>
          <div>
            <dt>Bildirimler</dt>
            <dd>
              Yüksek ve kritik olay aktarımı uygulama içi bildirim oluşturur. Bu
              bildirim, e-postanın veya dış mesajın gönderildiğini göstermez.
              E-posta profili kaydetmek de teslimat başlatmaz.
            </dd>
          </div>
          <div>
            <dt>İnceleme kararı</dt>
            <dd>
              Not, devam, kapatma ve yeniden açma kararları Vigil içindeki
              kayıtları günceller. Hesap engelleme, ağ erişimi değiştirme veya
              otomatik tehdit kararı uygulamaz.
            </dd>
          </div>
        </dl>
        {canReview && (
          <GuideLinks
            links={[
              { page: "notifications", label: "Bildirimler" },
            ]}
            onNavigate={onNavigate}
          />
        )}
      </section>

      <div className="working-guide-tracks">
        <section
          className="panel working-guide-card"
          aria-labelledby={`${headingId}-access`}
        >
          <h3 id={`${headingId}-access`}>Oturumunuz ve erişiminiz</h3>
          <dl className="working-guide-session">
            <div>
              <dt>Kullanıcı</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>Rol</dt>
              <dd>{roleLabels[user.role]}</dd>
            </div>
            <div>
              <dt>Sürüm</dt>
              <dd>{status?.version || "Bilgi henüz alınmadı"}</dd>
            </div>
          </dl>
          <p>
            {canReview
              ? "Yönetici ve analist rollerinde varlık, üyelik, olay ve dosya inceleme ekranlarını kullanabilir, kaynakları görüntüleyebilirsiniz. Kaynak değişiklikleri, JSON olay aktarımı, posta kanalı ayarları, kullanıcı yönetimi ve işlem günlüğü yalnız yöneticiye açıktır."
              : "Bu rolde Hesabım ve çalışma rehberine erişebilirsiniz. İnceleme ekranları yönetici ve analiste, kullanıcı yönetimi ve işlem günlüğü yalnız yöneticiye açıktır."}
          </p>
          <GuideLinks
            links={[
              { page: "account", label: "Hesabım" },
              ...(user.role === "admin"
                ? [
                    { page: "audit" as const, label: "İşlem günlüğü" },
                    ...(!demo
                      ? [
                          {
                            page: "users" as const,
                            label: "Kullanıcılar",
                          },
                        ]
                      : []),
                  ]
                : []),
            ]}
            onNavigate={onNavigate}
          />
        </section>
        <section
          className="panel working-guide-card"
          aria-labelledby={`${headingId}-operation`}
        >
          <h3 id={`${headingId}-operation`}>Çalışma ve kurulum kapsamı</h3>
          <p>
            Bu sürüm yerel kullanıcılar ve veritabanıyla çalışan bir manuel
            inceleme alanıdır. Canlı kurum kaynaklarından otomatik toplama ve
            dış bildirim teslimatı bu çalışma biçiminin parçası değildir.
          </p>
          <p>
            Kurumda kullanıma geçerken kurulum, erişim, yedekleme ve geri
            yükleme adımlarını kurumun kendi ortamında ayrıca doğrulayın.
            Buradaki kayıtlar ve demo, bu doğrulamanın yerine geçmez.
          </p>
        </section>
      </div>
    </div>
  );
}
