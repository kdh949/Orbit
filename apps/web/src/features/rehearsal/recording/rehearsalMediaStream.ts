export function setMediaStreamTracksEnabled(
  stream: MediaStream | null,
  enabled: boolean,
) {
  stream?.getAudioTracks().forEach((track) => {
    track.enabled = enabled;
  });
}

export function isReusableRehearsalMediaStream(stream: MediaStream | null) {
  if (!stream) {
    return false;
  }

  return stream.getAudioTracks().some((track) => track.readyState === "live");
}
