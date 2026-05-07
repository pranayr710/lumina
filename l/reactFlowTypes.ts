import CameraNode from "@/c/nodes/CameraNode";
import VideoNode from "@/c/nodes/VideoNode";
import DetectionNode from "@/c/nodes/DetectionNode";
import VisualLlmNode from "@/c/nodes/VisualLlmNode";
import LogicNode from "@/c/nodes/LogicNode";
import LlmNode from "@/c/nodes/LlmNode";
import SoundAlertNode from "@/c/nodes/SoundAlertNode";
import LogNode from "@/c/nodes/LogNode";
import NotifyNode from "@/c/nodes/NotifyNode";
import ScreenshotNode from "@/c/nodes/ScreenshotNode";
import WebhookNode from "@/c/nodes/WebhookNode";
import EmailNode from "@/c/nodes/EmailNode";
import SmsNode from "@/c/nodes/SmsNode";
import MicNode from "@/c/nodes/MicNode";
import AudioDetectNode from "@/c/nodes/AudioDetectNode";
import AudioLlmNode from "@/c/nodes/AudioLlmNode";
import AudioFileNode from "@/c/nodes/AudioFileNode";
import ScriptNode from "@/c/nodes/ScriptNode";
import WhisperNode from "@/c/nodes/WhisperNode";
import IpCameraNode from "@/c/nodes/IpCameraNode";
import DebounceNode from "@/c/nodes/DebounceNode";
import MergeNode from "@/c/nodes/MergeNode";
import FileNode from "@/c/nodes/FileNode";
import OcrNode from "@/c/nodes/OcrNode";
import PoseNode from "@/c/nodes/PoseNode";
import MqttNode from "@/c/nodes/MqttNode";
import FaceMatchNode from "@/c/nodes/FaceMatchNode";
import SpeakNode from "@/c/nodes/SpeakNode";
import DiscordNode from "@/c/nodes/DiscordNode";
import SlackNode from "@/c/nodes/SlackNode";
import GoogleSheetsNode from "@/c/nodes/GoogleSheetsNode";
import GeminiLiveNode from "@/c/nodes/GeminiLiveNode";
import ToolUseNode from "@/c/nodes/ToolUseNode";

export const NODE_TYPES = {
  camera: CameraNode,
  video: VideoNode,
  detection: DetectionNode,
  visualLlm: VisualLlmNode,
  logic: LogicNode,
  llm: LlmNode,
  soundAction: SoundAlertNode,
  logAction: LogNode,
  notifyAction: NotifyNode,
  screenshotAction: ScreenshotNode,
  webhookAction: WebhookNode,
  emailAction: EmailNode,
  smsAction: SmsNode,
  mic: MicNode,
  audioDetect: AudioDetectNode,
  audioLlm: AudioLlmNode,
  audioFile: AudioFileNode,
  script: ScriptNode,
  whisperStt: WhisperNode,
  ipCamera: IpCameraNode,
  debounce: DebounceNode,
  merge: MergeNode,
  fileAction: FileNode,
  ocr: OcrNode,
  pose: PoseNode,
  mqttAction: MqttNode,
  faceMatch: FaceMatchNode,
  speakAction: SpeakNode,
  discordAction: DiscordNode,
  slackAction: SlackNode,
  googleSheetsAction: GoogleSheetsNode,
  // Hackathon additions
  geminiLive: GeminiLiveNode,
  toolUse: ToolUseNode,
};
