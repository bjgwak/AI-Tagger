import { useRef, useState, useEffect, useCallback } from "react";
import { inferenceMostRelevantTag } from "../clsFunc";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

interface VideoAnalyzerProps {
  src: string | null;
  originalFile: File | null;
}

export function VideoAnalyzer({ src, originalFile }: VideoAnalyzerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const frameCallbackHandleRef = useRef<number | null>(null);

  const resultUrlRef = useRef<string | null>(null);
  const resultVideoFileNameRef = useRef<string | null>(null); // 새로 추가

  const [taggedTimestamps, setTaggedTimestamps] = useState<
    Map<string, number[]>
  >(new Map());
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isFFmpegReady, setIsFFmpegReady] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [resultVideoSrc, setResultVideoSrc] = useState<string | null>(null);

  useEffect(() => {
    const loadFFmpeg = async () => {
      try {
        const ffmpeg = new FFmpeg();
        const baseURL = "/";
        await ffmpeg.load({
          coreURL: await toBlobURL(
            `${baseURL}ffmpeg-core.js`,
            "text/javascript"
          ),
          wasmURL: await toBlobURL(
            `${baseURL}ffmpeg-core.wasm`,
            "application/wasm"
          ),
          workerURL: await toBlobURL(
            `${baseURL}ffmpeg-core.worker.js`,
            "text/javascript"
          ),
        });
        ffmpegRef.current = ffmpeg;
        setIsFFmpegReady(true);
      } catch (err) {
        console.error("FFmpeg 로딩 실패:", err);
      }
    };
    loadFFmpeg();
  }, []);

  const analyzeFrameByFrame = useCallback(
    async (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata) => {
      if (!videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      try {
        const tag = await inferenceMostRelevantTag(canvas);
        if (tag) {
          setTaggedTimestamps((prevMap) => {
            const newMap = new Map(prevMap);
            const timestamps = newMap.get(tag) || [];
            newMap.set(tag, [...timestamps, metadata.mediaTime]);
            return newMap;
          });
        }
      } catch (err) {
        console.error("프레임 분석 오류:", err);
      } finally {
        if (!video.paused) {
          frameCallbackHandleRef.current =
            video.requestVideoFrameCallback(analyzeFrameByFrame);
        }
      }
    },
    []
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isFFmpegReady) return;

    const startAnalysis = () => {
      if (!video.paused) {
        frameCallbackHandleRef.current =
          video.requestVideoFrameCallback(analyzeFrameByFrame);
      }
    };

    const stopAnalysis = () => {
      if (frameCallbackHandleRef.current) {
        video.cancelVideoFrameCallback(frameCallbackHandleRef.current);
        frameCallbackHandleRef.current = null;
      }
    };

    video.addEventListener("play", startAnalysis);
    video.addEventListener("pause", stopAnalysis);
    video.addEventListener("ended", stopAnalysis);
    video.addEventListener("seeked", () => setTaggedTimestamps(new Map()));

    return () => {
      video.removeEventListener("play", startAnalysis);
      video.removeEventListener("pause", stopAnalysis);
      video.removeEventListener("ended", stopAnalysis);
      video.removeEventListener("seeked", () => setTaggedTimestamps(new Map()));
      stopAnalysis();
    };
  }, [src, isFFmpegReady, analyzeFrameByFrame]);

  useEffect(() => {
    setTaggedTimestamps(new Map());
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    setResultVideoSrc(null);
    resultVideoFileNameRef.current = null;
  }, [src]);

  const handleTagClick = async (tag: string) => {
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg || !isFFmpegReady || !originalFile || isProcessing) return;

    setIsProcessing(true);
    if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
    setResultVideoSrc(null);

    setStatusMessage("영상 처리를 준비 중입니다...");

    try {
      const timestamps = (taggedTimestamps.get(tag) || []).sort(
        (a, b) => a - b
      );
      if (timestamps.length === 0) return;

      const ranges: [number, number][] = [];
      const THRESHOLD = 0.1;
      let start = timestamps[0];
      let end = timestamps[0];
      for (let i = 1; i < timestamps.length; i++) {
        if (timestamps[i] - end < THRESHOLD) {
          end = timestamps[i];
        } else {
          ranges.push([start, end]);
          start = timestamps[i];
          end = timestamps[i];
        }
      }
      ranges.push([start, end]);

      const selectFilter = ranges
        .map(([s, e]) => `between(t,${s},${e})`)
        .join("+");

      await ffmpeg.writeFile(originalFile.name, await fetchFile(originalFile));

      const outputFileName = `output_${tag}_${Date.now()}.mp4`;
      resultVideoFileNameRef.current = outputFileName;

      await ffmpeg.exec([
        "-i",
        originalFile.name,
        "-vf",
        `select='${selectFilter}',setpts=N/FRAME_RATE/TB`,
        "-af",
        `aselect='${selectFilter}',asetpts=N/SR/TB`,
        outputFileName,
      ]);

      const data = await ffmpeg.readFile(outputFileName);
      const url = URL.createObjectURL(
        new Blob([(data as Uint8Array).buffer], { type: "video/mp4" })
      );
      resultUrlRef.current = url;
      setResultVideoSrc(url);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const applyGrayscaleFilter = async () => {
    const ffmpeg = ffmpegRef.current;
    const inputName = resultVideoFileNameRef.current;
    if (!ffmpeg || !isFFmpegReady || !inputName || isProcessing) return;

    setIsProcessing(true);
    setStatusMessage("흑백 필터 적용 중...");

    try {
      const outputName = `gray_${Date.now()}.mp4`;
      resultVideoFileNameRef.current = outputName;

      await ffmpeg.exec(["-i", inputName, "-vf", "hue=s=0", outputName]);

      const data = await ffmpeg.readFile(outputName);
      const url = URL.createObjectURL(
        new Blob([(data as Uint8Array).buffer], { type: "video/mp4" })
      );
      if (resultUrlRef.current) URL.revokeObjectURL(resultUrlRef.current);
      resultUrlRef.current = url;
      setResultVideoSrc(url);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  const convertToGif = async () => {
    const ffmpeg = ffmpegRef.current;
    const inputName = resultVideoFileNameRef.current;
    if (!ffmpeg || !isFFmpegReady || !inputName || isProcessing) return;

    setIsProcessing(true);
    setStatusMessage("GIF로 변환 중...");

    try {
      const gifName = `converted_${Date.now()}.gif`;

      await ffmpeg.exec([
        "-i",
        inputName,
        "-vf",
        "fps=30,scale=320:-1:flags=lanczos",
        gifName,
      ]);

      const data = await ffmpeg.readFile(gifName);
      const blob = new Blob([(data as Uint8Array).buffer], {
        type: "image/gif",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = gifName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="video-analyzer-container">
      <div className="main-content">
        <div className="video-section">
          <h3>원본 영상</h3>
          <div className="video-container">
            {src ? (
              <video ref={videoRef} key={src} controls src={src} />
            ) : (
              <span className="placeholder-text">
                영상을 업로드하면 영상이 여기에 표시됩니다.
              </span>
            )}
          </div>
          <div className="tag-chip-container">
            {Array.from(taggedTimestamps.keys()).map((tag) => (
              <button
                key={tag}
                className="tag-chip"
                onClick={() => handleTagClick(tag)}
                disabled={isProcessing || !isFFmpegReady}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>

        <div className="video-section">
          <h3>결과 영상</h3>
          <div className="video-container">
            {isProcessing ? (
              <span className="placeholder-text">{statusMessage}</span>
            ) : resultVideoSrc ? (
              <video
                key={resultVideoSrc}
                controls
                autoPlay
                src={resultVideoSrc}
              />
            ) : (
              <span className="placeholder-text">
                태그를 클릭하면 편집결과가 여기에 표시됩니다.
              </span>
            )}
          </div>
          {/* 🔽 여기 추가됨 */}
          <div className="tag-chip-container">
            <button
              onClick={convertToGif}
              disabled={isProcessing || !resultVideoSrc}
              className="tag-chip"
            >
              GIF로 만들기
            </button>
            <button
              onClick={applyGrayscaleFilter}
              disabled={isProcessing || !resultVideoSrc}
              className="tag-chip"
            >
              흑백 필터 적용
            </button>
          </div>
        </div>
      </div>
      <canvas ref={canvasRef} style={{ display: "none" }} />
    </div>
  );
}
