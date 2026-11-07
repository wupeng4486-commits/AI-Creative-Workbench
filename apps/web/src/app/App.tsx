import { useEffect, useState } from "react";

export function App() {
  const [info, setInfo] = useState<{ version: string; dataDir: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/system/info")
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then(setInfo)
      .catch(() => setError("本机服务未响应"));
  }, []);

  return (
    <main style={{ padding: 48, fontFamily: "system-ui, sans-serif" }}>
      <h1>企业 AI 内容生产平台</h1>
      <p>本机演示工作台正在初始化。</p>
      {info && <p>服务版本 {info.version}（未启用前端壳）</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
