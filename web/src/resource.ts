import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";

export function useAlive() {
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

// A request generation belongs to one mounted view. A later refresh, filter
// change, demo transition, or unmount invalidates its earlier response.
export function useResource<T>(
  path: string,
  demo: boolean,
  fixture: T,
  onSessionExpired: () => void,
  validate?: (value: unknown) => boolean,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolvedRequest, setResolvedRequest] = useState<{
    path: string;
    demo: boolean;
  } | null>(null);
  const generation = useRef(0);
  const alive = useAlive();
  const current = useRef({ path, demo });
  current.current = { path, demo };
  const fallback = useRef(fixture);
  fallback.current = fixture;
  const validator = useRef(validate);
  validator.current = validate;
  const expire = useRef(onSessionExpired);
  expire.current = onSessionExpired;
  const refresh = useCallback(async () => {
    if (!alive.current) return;
    const { path: requestPath, demo: isDemo } = current.current;
    const ticket = ++generation.current;
    setError("");
    setLoading(true);
    if (isDemo) {
      setData(fallback.current);
      setResolvedRequest({ path: requestPath, demo: isDemo });
      setLoading(false);
      return;
    }
    const active = () =>
      alive.current &&
      ticket === generation.current &&
      current.current.path === requestPath &&
      current.current.demo === isDemo;
    try {
      const result = await api<T>(requestPath, "GET", undefined, validator.current);
      if (active()) {
        setData(result);
        setResolvedRequest({ path: requestPath, demo: isDemo });
      }
    } catch (err) {
      if (active()) {
        setError((err as Error).message);
        setData(null);
        setResolvedRequest({ path: requestPath, demo: isDemo });
        if (err instanceof ApiError && err.status === 401) expire.current();
      }
    } finally {
      if (active()) setLoading(false);
    }
  }, [alive]);
  useEffect(() => {
    void refresh();
    return () => {
      generation.current++;
    };
  }, [path, demo, refresh]);
  return {
    data,
    loading,
    error,
    refresh,
    setData,
    matchesRequest:
      resolvedRequest !== null &&
      resolvedRequest.path === path &&
      resolvedRequest.demo === demo,
  };
}
