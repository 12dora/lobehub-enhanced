import type { AIChatModelCard } from '../types/aiModel';

const longcatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'LongCat-2.0 is a 1600B MoE language model from Meituan designed for agent development scenarios. It natively supports tool calling, multi-step reasoning, and long-context tasks, with strong performance in code generation, automated workflows, and complex instruction execution. It is deeply integrated with productivity tools including Claude Code, OpenClaw, OpenCode, and Kilo Code.',
    displayName: 'LongCat-2.0',
    enabled: true,
    family: 'longcat',
    generation: 'longcat-2.0',
    id: 'LongCat-2.0',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-30',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'The core features of LongCat-2.0-Preview are as follows: Designed for agent development scenarios, with native support for tool use, multi-step reasoning, and long-context tasks; Excels in code generation, automated workflows, and complex instruction execution; Deeply integrated with productivity tools such as Claude Code, OpenClaw, OpenCode, and Kilo Code.',
    displayName: 'LongCat-2.0-Preview',
    enabled: true,
    family: 'longcat',
    generation: 'longcat-2.0',
    id: 'LongCat-2.0-Preview',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    type: 'chat',
  },
];

export const allModels = [...longcatModels];

export default allModels;
