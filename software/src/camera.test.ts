import { expect, test, describe } from "bun:test";
import { classifyCameraSource, sourceId } from "./camera.ts";

describe("classifyCameraSource", () => {
  test("recognises RTSP URLs (with and without credentials)", () => {
    expect(classifyCameraSource("rtsp://192.168.1.50:554/stream1")).toBe("rtsp");
    expect(classifyCameraSource("rtsp://user:pass@192.168.1.50:554/stream1")).toBe("rtsp");
    expect(classifyCameraSource("rtsps://cam.local/stream")).toBe("rtsp");
  });

  test("recognises HTTP snapshot URLs", () => {
    expect(classifyCameraSource("http://192.168.1.60/snapshot.jpg")).toBe("http");
    expect(classifyCameraSource("https://cam.local/cgi-bin/snap")).toBe("http");
  });

  test("rejects unsupported sources", () => {
    expect(() => classifyCameraSource("picamera:0")).toThrow();
    expect(() => classifyCameraSource("/dev/video0")).toThrow();
    expect(() => classifyCameraSource("ftp://host/x")).toThrow();
  });
});

describe("sourceId", () => {
  test("derives a filesystem-safe id from the host, dropping credentials", () => {
    const id = sourceId("rtsp://user:pass@192.168.1.50:554/stream1");
    expect(id).toBe("192_168_1_50_554");
    expect(id).not.toContain("user");
    expect(id).not.toContain("pass");
  });

  test("handles plain hosts", () => {
    expect(sourceId("http://cam.local/snap")).toBe("cam_local");
  });
});
