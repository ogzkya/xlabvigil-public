import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./components";

function formSnapshot(element: HTMLElement | null) {
  if (!element) return "";
  return JSON.stringify(
    Array.from(
      element.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >("input, select, textarea"),
    ).map((field) => [
      field.tagName,
      field.name,
      field instanceof HTMLInputElement &&
      (field.type === "checkbox" || field.type === "radio")
        ? field.checked
        : field instanceof HTMLSelectElement && field.multiple
          ? Array.from(field.selectedOptions, (option) => option.value)
          : field.value,
    ]),
  );
}

// Each mounted form owns its initial values. Closing never discards a changed
// form until the user explicitly chooses to do so. Hidden method-specific
// drafts can supply an additional dirty flag without storing any draft here.
export default function FormModal({
  title,
  subtitle,
  onClose,
  children,
  wide = false,
  closeDisabled = false,
  hasUnsavedChanges = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: (requestClose: () => void) => ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
  hasUnsavedChanges?: boolean;
}) {
  const content = useRef<HTMLDivElement>(null);
  const baseline = useRef("");
  const [discardPending, setDiscardPending] = useState(false);
  useLayoutEffect(() => {
    baseline.current = formSnapshot(content.current);
  }, []);

  function requestClose() {
    if (closeDisabled) return;
    if (
      hasUnsavedChanges ||
      formSnapshot(content.current) !== baseline.current
    ) {
      setDiscardPending(true);
      return;
    }
    onClose();
  }

  return (
    <>
      <Modal
        title={title}
        subtitle={subtitle}
        onClose={requestClose}
        wide={wide}
        closeDisabled={closeDisabled}
      >
        <div ref={content}>{children(requestClose)}</div>
      </Modal>
      {discardPending && (
        <Modal
          title="Kaydedilmemiş değişiklikler"
          subtitle="Formdaki taslak henüz kaydedilmedi."
          onClose={() => setDiscardPending(false)}
          closeDisabled={closeDisabled}
        >
          <div className="detail-body">
            <p className="detail-description">
              Pencereyi kapatırsanız bu formdaki değişiklikler silinecek.
              Taslağı koruyarak düzenlemeye devam edebilirsiniz.
            </p>
          </div>
          <footer className="modal-actions">
            <button
              className="btn secondary"
              type="button"
              data-initial-focus
              disabled={closeDisabled}
              onClick={() => setDiscardPending(false)}
            >
              Taslağı koru
            </button>
            <button
              className="btn text-danger"
              type="button"
              disabled={closeDisabled}
              onClick={() => {
                if (!closeDisabled) onClose();
              }}
            >
              Taslağı sil ve kapat
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
