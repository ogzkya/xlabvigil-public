import { useEffect, useRef, useState } from "react";

export const MIN_LIST_SEARCH_LENGTH = 3;
export const MAX_LIST_SEARCH_LENGTH = 120;

// Paged server lists share the same input threshold, delay, and page reset.
// Demo lists keep filtering their local fixtures without a server request.
export function useListSearch(
  query: string,
  demo: boolean,
  resetPage: () => void,
) {
  const [submittedSearch, setSubmittedSearch] = useState(() => {
    const initial = query.trim();
    const length = Array.from(initial).length;
    return length >= MIN_LIST_SEARCH_LENGTH && length <= MAX_LIST_SEARCH_LENGTH
      ? initial
      : "";
  });
  const resetPageRef = useRef(resetPage);
  resetPageRef.current = resetPage;
  const search = query.trim();
  const length = Array.from(search).length;
  const tooShort = !demo && length > 0 && length < MIN_LIST_SEARCH_LENGTH;
  const tooLong = !demo && length > MAX_LIST_SEARCH_LENGTH;
  const invalid = tooShort || tooLong;
  const pending = !demo && !invalid && search !== submittedSearch;

  useEffect(() => {
    if (demo || invalid || search === submittedSearch) return;
    const timer = window.setTimeout(() => {
      setSubmittedSearch(search);
      resetPageRef.current();
    }, 300);
    return () => window.clearTimeout(timer);
  }, [demo, invalid, search, submittedSearch]);

  return { submittedSearch, tooShort, tooLong, invalid, pending };
}
