# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "faster-whisper>=1.1.0",
#   "av<16",
#   "nvidia-cublas-cu12; sys_platform == 'win32' or sys_platform == 'linux'",
#   "nvidia-cudnn-cu12>=9,<10; sys_platform == 'win32' or sys_platform == 'linux'",
# ]
# ///
import argparse
import json
import os
import sys
from importlib.util import find_spec
from pathlib import Path

MODEL = "large-v3-turbo"
AUDIO_SUFFIXES = {".ogg", ".opus", ".oga", ".mp3", ".m4a", ".wav", ".webm"}


def expose_cuda_wheels() -> None:
    # The nvidia-* wheels ship their DLLs in site-packages, which Windows does not search by default
    for package in ("nvidia.cublas", "nvidia.cudnn"):
        spec = find_spec(package)
        if spec is None or not spec.submodule_search_locations:
            continue
        bin_dir = Path(next(iter(spec.submodule_search_locations))) / "bin"
        if bin_dir.is_dir():
            if hasattr(os, "add_dll_directory"):
                os.add_dll_directory(str(bin_dir))
            os.environ["PATH"] = f"{bin_dir}{os.pathsep}{os.environ['PATH']}"


expose_cuda_wheels()
from faster_whisper import WhisperModel  # noqa: E402


class Transcriber:
    def __init__(self, language: str | None) -> None:
        self.language = language
        try:
            self.model = WhisperModel(MODEL, device="cuda", compute_type="float16")
            self.on_gpu = True
        except (RuntimeError, ValueError) as error:
            self._use_cpu(error)

    def transcribe(self, audio: Path) -> str:
        try:
            return self._transcribe(audio)
        except RuntimeError as error:
            # CUDA libraries load lazily, so a broken GPU setup often fails here rather than at model load
            if not self.on_gpu:
                raise
            self._use_cpu(error)
            return self._transcribe(audio)

    def _use_cpu(self, error: Exception) -> None:
        print(f"GPU unavailable ({error}), falling back to CPU", file=sys.stderr)
        self.model = WhisperModel(MODEL, device="cpu", compute_type="int8")
        self.on_gpu = False

    def _transcribe(self, audio: Path) -> str:
        segments, _ = self.model.transcribe(str(audio), language=self.language, vad_filter=True)
        return " ".join(segment.text.strip() for segment in segments)


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe every audio file in a folder into transcripts.json")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--language", default=None, help="ISO code such as 'it' or 'en'. Omit to auto-detect.")
    return parser.parse_args()


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    arguments = parse_arguments()
    audios = sorted(p for p in arguments.folder.iterdir() if p.suffix.lower() in AUDIO_SUFFIXES)
    transcripts = {}
    if audios:
        transcriber = Transcriber(arguments.language)
        transcripts = {audio.name: transcriber.transcribe(audio) for audio in audios}
    output = json.dumps(transcripts, ensure_ascii=False, indent=2)
    (arguments.folder / "transcripts.json").write_text(output, encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
