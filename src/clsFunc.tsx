import * as ort from "onnxruntime-web";

const modelPath = "/mobilenetv2-7.onnx";
const labelsPath = "/imagenet_labels.json";

function canvasImageToTensor(
  imageSource: HTMLImageElement | HTMLCanvasElement
): ort.Tensor {
  const canvas = document.createElement("canvas");
  canvas.width = 224;
  canvas.height = 224;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas creation error");

  ctx.drawImage(imageSource, 0, 0, 224, 224);
  const imageData = ctx.getImageData(0, 0, 224, 224);
  const { data } = imageData;

  const preprocessedData = new Float32Array(1 * 3 * 224 * 224);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];

  for (let i = 0; i < data.length; i += 4) {
    const pixelIndex = i / 4;
    preprocessedData[pixelIndex] = (data[i] / 255 - mean[0]) / std[0];
    preprocessedData[224 * 224 + pixelIndex] =
      (data[i + 1] / 255 - mean[1]) / std[1];
    preprocessedData[2 * 224 * 224 + pixelIndex] =
      (data[i + 2] / 255 - mean[2]) / std[2];
  }
  return new ort.Tensor("float32", preprocessedData, [1, 3, 224, 224]);
}

export async function inferenceMostRelevantTag(
  canvasImage: HTMLCanvasElement
): Promise<string> {
  const session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["wasm"],
  });
  const labels = await fetch(labelsPath).then((response) => response.json());

  const inputTensor = canvasImageToTensor(canvasImage);
  const feeds = { [session.inputNames[0]]: inputTensor };

  const results = await session.run(feeds);
  const outputData = results[session.outputNames[0]].data as Float32Array;

  let maxProb = -Infinity;
  let maxIndex = -1;
  for (let i = 0; i < outputData.length; i++) {
    if (outputData[i] > maxProb) {
      maxProb = outputData[i];
      maxIndex = i;
    }
  }

  const top1TagName = labels[maxIndex].split(",")[0];

  return top1TagName;
}
