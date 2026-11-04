import CameraNode from "@/components/nodes/CameraNode";
import VideoNode from "@/components/nodes/VideoNode";
import DetectionNode from "@/components/nodes/DetectionNode";
import VisualLlmNode from "@/components/nodes/VisualLlmNode";
import LogicNode from "@/components/nodes/LogicNode";
import LlmNode from "@/components/nodes/LlmNode";
import SoundAlertNode from "@/components/nodes/SoundAlertNode";
import LogNode from "@/components/nodes/LogNode";
import NotifyNode from "@/components/nodes/NotifyNode";
import ScreenshotNode from "@/components/nodes/ScreenshotNode";
import WebhookNode from "@/components/nodes/WebhookNode";
import EmailNode from "@/components/nodes/EmailNode";
import SmsNode from "@/components/nodes/SmsNode";
import MicNode from "@/components/nodes/MicNode";
import AudioDetectNode from "@/components/nodes/AudioDetectNode";
import AudioLlmNode from "@/components/nodes/AudioLlmNode";
import AudioFileNode from "@/components/nodes/AudioFileNode";
import ScriptNode from "@/components/nodes/ScriptNode";
import WhisperNode from "@/components/nodes/WhisperNode";
import IpCameraNode from "@/components/nodes/IpCameraNode";
import DebounceNode from "@/components/nodes/DebounceNode";
import MergeNode from "@/components/nodes/MergeNode";
import FileNode from "@/components/nodes/FileNode";
import OcrNode from "@/components/nodes/OcrNode";
import PoseNode from "@/components/nodes/PoseNode";
import MqttNode from "@/components/nodes/MqttNode";
import FaceMatchNode from "@/components/nodes/FaceMatchNode";
import SpeakNode from "@/components/nodes/SpeakNode";
import DiscordNode from "@/components/nodes/DiscordNode";
import SlackNode from "@/components/nodes/SlackNode";
import GoogleSheetsNode from "@/components/nodes/GoogleSheetsNode";
import GeminiLiveNode from "@/components/nodes/GeminiLiveNode";
import ToolUseNode from "@/components/nodes/ToolUseNode";

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
