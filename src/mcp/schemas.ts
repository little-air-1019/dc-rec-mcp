// Zod input schemas for the four MCP tools, as ZodRawShape objects (the shape
// registerTool expects). These mirror the plan's tool input JSON and the
// Slice 1 tool-io types. Validation happens at the SDK boundary.

import { z } from 'zod';

import { MEETING_TYPES } from '../domain/meeting';
import { EXPORT_CONTAINERS, EXPORT_FORMATS, EXPORT_MODES } from '../domain/tool-io';

const meetingType = z.enum(MEETING_TYPES as unknown as [string, ...string[]]);
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const startRecordingShape = {
  guildId: z.string().min(1),
  voiceChannelId: z.string().min(1),
  requesterUserId: z.string().min(1),
  textChannelId: z.string().min(1),
  type: meetingType,
  date: dateString,
  title: z.string().optional(),
  recordingId: z.string().optional()
};

export const statusRecordingShape = {
  recordingId: z.string().optional(),
  guildId: z.string().optional()
};

export const stopRecordingShape = {
  recordingId: z.string().optional(),
  guildId: z.string().optional(),
  stoppedByUserId: z.string().optional()
};

export const exportRecordingShape = {
  recordingId: z.string().min(1),
  format: z.enum(EXPORT_FORMATS as unknown as [string, ...string[]]),
  container: z.enum(EXPORT_CONTAINERS as unknown as [string, ...string[]]),
  mode: z.enum(EXPORT_MODES as unknown as [string, ...string[]]),
  outputDir: z.string().optional()
};
