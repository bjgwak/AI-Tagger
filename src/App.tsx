/*
 * =================================================================
 * 파일: src/App.tsx
 * 설명: 전체 앱의 레이아웃을 감싸는 컨테이너를 추가합니다.
 * =================================================================
 */
import { useState, useRef, useEffect } from "react";
import "./App.css";
import { VideoAnalyzer } from "./components/VideoAnalyzer";

function App() {
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }

    const newUrl = URL.createObjectURL(file);
    objectUrlRef.current = newUrl;

    setVideoFile(file);
    setVideoSrc(newUrl);
  };

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
      }
    };
  }, []);

  return (
    <div className="app-container">
      <header className="app-header">
        <h1>AI Video Tagger</h1>
        <p>분석하고 싶은 비디오 파일을 선택하세요.</p>
        <input
          type="file"
          className="file-input"
          onChange={handleFileChange}
          accept="video/*"
        />
      </header>
      <main>
        <VideoAnalyzer src={videoSrc} originalFile={videoFile} />
      </main>
    </div>
  );
}

export default App;
