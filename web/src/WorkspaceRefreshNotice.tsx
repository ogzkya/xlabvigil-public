import { InlineError, Loading } from "./components";

export type WorkspaceRefreshState = {
  loading: boolean;
  error: string;
  onRetry: () => void;
};

export default function WorkspaceRefreshNotice({
  loading,
  error,
  onRetry,
}: WorkspaceRefreshState) {
  if (loading) {
    return <Loading label="Çalışma alanı yenileniyor; taslağınız korunuyor…" />;
  }
  if (!error) return null;
  return (
    <InlineError
      message="Çalışma alanı yenilenemedi. Son yüklenen bilgiler ve taslağınız korundu; kaydetmek için yeniden yükleyin."
      detail={error}
      onRetry={onRetry}
      retryLabel="Çalışma alanını yenile"
    />
  );
}
