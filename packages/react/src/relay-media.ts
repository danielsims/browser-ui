import { useEffect, useMemo, useRef } from "react";

import type { RelayHello } from "@browser-ui/core";
import {
  parseRelayVideoHeader,
  RELAY_AUDIO,
  RELAY_AUDIO_SAMPLE_RATE,
  RELAY_VIDEO,
  RELAY_VIDEO_CODEC,
  RELAY_VIDEO_HEADER_BYTES,
  relayCommand,
} from "@browser-ui/core";

/** Sound is held this far ahead of playback, to ride out network jitter. */
const AUDIO_LEAD_SECONDS = 0.06;
/** Further behind than this and sound skips ahead rather than lagging. */
const AUDIO_MAX_LEAD_SECONDS = 0.25;

export interface RelayMediaOptions {
  canvas: () => HTMLCanvasElement | null;
  send: (text: string) => boolean;
  /** A frame was drawn at this size. */
  onFrame: (width: number, height: number) => void;
}

/** Plays a relay stream's video and sound for one connection. */
export interface RelayMedia {
  readonly soundAvailable: boolean;
  hello: (hello: RelayHello) => void;
  receive: (data: ArrayBuffer) => void;
  setVisible: (visible: boolean) => void;
  /** Call from a user gesture: browsers only start sound after one. */
  setSound: (on: boolean) => Promise<void>;
  close: () => void;
}

export function relayMediaSupported() {
  return typeof VideoDecoder !== "undefined";
}

export function createRelayMedia({
  canvas,
  send,
  onFrame,
}: RelayMediaOptions): RelayMedia {
  let decoder: VideoDecoder | null = null;
  let waitingForKey = true;
  let visible = false;
  let started = false;
  let offersSound = false;
  let sound: { context: AudioContext; decoder: AudioDecoder } | null = null;
  let playAt = 0;
  let audioTimestamp = 0;

  const resetVideo = () => {
    if (decoder && decoder.state !== "closed") decoder.close();
    decoder = null;
    waitingForKey = true;
  };
  const restartVideo = () => {
    resetVideo();
    if (started && visible) send(relayCommand.keyframe);
  };
  const openDecoder = () => {
    const next = new VideoDecoder({
      output: (frame) => {
        const target = canvas();
        if (target) {
          if (target.width !== frame.displayWidth)
            target.width = frame.displayWidth;
          if (target.height !== frame.displayHeight)
            target.height = frame.displayHeight;
          target.getContext("2d")?.drawImage(frame, 0, 0);
        }
        const id = frame.timestamp;
        const { displayWidth, displayHeight } = frame;
        frame.close();
        send(relayCommand.ack(id));
        onFrame(displayWidth, displayHeight);
      },
      // A bad frame costs one keyframe, not the stream.
      error: () => restartVideo(),
    });
    next.configure({
      codec: RELAY_VIDEO_CODEC,
      optimizeForLatency: true,
      hardwareAcceleration: "no-preference",
    });
    return next;
  };

  const playSound = (data: AudioData) => {
    const active = sound;
    if (!active) {
      data.close();
      return;
    }
    const { context } = active;
    const buffer = context.createBuffer(
      data.numberOfChannels,
      data.numberOfFrames,
      data.sampleRate,
    );
    for (let channel = 0; channel < data.numberOfChannels; channel += 1) {
      const samples = new Float32Array(data.numberOfFrames);
      data.copyTo(samples, { planeIndex: channel, format: "f32-planar" });
      buffer.copyToChannel(samples, channel);
    }
    data.close();
    const now = context.currentTime;
    if (playAt < now || playAt > now + AUDIO_MAX_LEAD_SECONDS)
      playAt = now + AUDIO_LEAD_SECONDS;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start(playAt);
    playAt += buffer.duration;
  };

  const stopSound = () => {
    if (!sound) return;
    if (sound.decoder.state !== "closed") sound.decoder.close();
    void sound.context.close();
    sound = null;
  };

  return {
    get soundAvailable() {
      return offersSound && typeof AudioDecoder !== "undefined";
    },
    hello(hello) {
      started = true;
      offersSound = hello.audio;
      resetVideo();
      if (visible) send(relayCommand.video(true));
      if (sound) send(relayCommand.audio(true));
    },
    receive(data) {
      const bytes = new Uint8Array(data);
      if (bytes[0] === RELAY_AUDIO) {
        if (sound?.decoder.state !== "configured") return;
        sound.decoder.decode(
          new EncodedAudioChunk({
            type: "key",
            timestamp: audioTimestamp,
            data: bytes.subarray(1),
          }),
        );
        audioTimestamp += 10_000;
        return;
      }
      if (bytes[0] !== RELAY_VIDEO || !visible) return;
      const header = parseRelayVideoHeader(bytes);
      if (!header || (waitingForKey && !header.key)) return;
      waitingForKey = false;
      decoder ??= openDecoder();
      decoder.decode(
        new EncodedVideoChunk({
          type: header.key ? "key" : "delta",
          timestamp: header.frame,
          data: bytes.subarray(RELAY_VIDEO_HEADER_BYTES),
        }),
      );
    },
    setVisible(next) {
      if (next === visible) return;
      visible = next;
      // Off screen, nothing is captured or sent; back on, it starts at a keyframe.
      if (!next) resetVideo();
      if (started) send(relayCommand.video(next));
    },
    async setSound(on) {
      if (!on) {
        stopSound();
        if (started) send(relayCommand.audio(false));
        return;
      }
      if (sound || typeof AudioDecoder === "undefined") return;
      const context = new AudioContext({ sampleRate: RELAY_AUDIO_SAMPLE_RATE });
      await context.resume();
      const audioDecoder = new AudioDecoder({
        output: playSound,
        error: () => stopSound(),
      });
      audioDecoder.configure({
        codec: "opus",
        sampleRate: RELAY_AUDIO_SAMPLE_RATE,
        numberOfChannels: 2,
      });
      sound = { context, decoder: audioDecoder };
      playAt = 0;
      if (started) send(relayCommand.audio(true));
    },
    close() {
      resetVideo();
      stopSound();
      started = false;
    },
  };
}

export interface UseRelayMediaOptions {
  element: () => HTMLElement | null;
  canvas: () => HTMLCanvasElement | null;
  socket: () => WebSocket | null;
  /** Whether the viewer wants the session's sound. */
  sound: boolean;
  onFrame: (width: number, height: number) => void;
  onSoundAvailable?: (available: boolean) => void;
}

/**
 * The relay media for a viewport's current connection. The stream only runs
 * while the viewport is on screen and its page is visible.
 */
export function useRelayMedia(options: UseRelayMediaOptions) {
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });
  const mediaRef = useRef<RelayMedia | null>(null);
  const visibleRef = useRef(false);

  useEffect(() => {
    const element = optionsRef.current.element();
    if (!element) return;
    let onScreen = false;
    const update = () => {
      visibleRef.current = onScreen && document.visibilityState === "visible";
      mediaRef.current?.setVisible(visibleRef.current);
    };
    // Without IntersectionObserver, a mounted viewport counts as on screen.
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            onScreen = entry?.isIntersecting ?? false;
            update();
          });
    if (observer) observer.observe(element);
    else onScreen = true;
    update();
    document.addEventListener("visibilitychange", update);
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    void mediaRef.current?.setSound(options.sound);
  }, [options.sound]);

  return useMemo(
    () => ({
      /** A relay `hello` arrived: this connection is a relay stream. */
      start(hello: RelayHello) {
        mediaRef.current?.close();
        const media = createRelayMedia({
          canvas: () => optionsRef.current.canvas(),
          send: (text) => {
            const socket = optionsRef.current.socket();
            if (socket?.readyState !== WebSocket.OPEN) return false;
            socket.send(text);
            return true;
          },
          onFrame: (width, height) => optionsRef.current.onFrame(width, height),
        });
        mediaRef.current = media;
        media.setVisible(visibleRef.current);
        media.hello(hello);
        void media.setSound(optionsRef.current.sound);
        optionsRef.current.onSoundAvailable?.(media.soundAvailable);
      },
      /** Returns false when this connection isn't a relay stream. */
      receive(data: ArrayBuffer) {
        if (!mediaRef.current) return false;
        mediaRef.current.receive(data);
        return true;
      },
      stop() {
        mediaRef.current?.close();
        mediaRef.current = null;
      },
    }),
    [],
  );
}
