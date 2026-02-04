import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const planStepInputSchema = z
  .object({
    step: z.string().min(1, 'step is required'),
    nextStepNeeded: z.boolean(),
    stepNumber: z.number().int().min(1),
    totalSteps: z.number().int().min(1),
    isRevision: z.boolean().optional(),
    revisesStep: z.number().int().min(1).optional(),
    branchFromStep: z.number().int().min(1).optional(),
    branchId: z.string().min(1).optional(),
    needsMoreSteps: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.isRevision && value.revisesStep === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revisesStep'],
        message: 'revisesStep is required when isRevision is true',
      });
    }

    if (value.branchFromStep !== undefined && value.branchId === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['branchId'],
        message: 'branchId is required when branchFromStep is provided',
      });
    }
  });

export type PlanStepInput = z.infer<typeof planStepInputSchema>;

export interface PlanStepResult {
  stepNumber: number;
  totalSteps: number;
  nextStepNeeded: boolean;
  branches: string[];
  stepHistoryLength: number;
}

export class PlanStepTool {
  public readonly tool: Tool = {
    name: 'plan_step',
    description:
      'Record a structured planning step before running real tools. Supports revisions and branching.',
    inputSchema: {
      type: 'object',
      properties: {
        step: {
          type: 'string',
          description: 'Current planning step text.',
        },
        nextStepNeeded: {
          type: 'boolean',
          description: 'Whether another planning step is needed.',
        },
        stepNumber: {
          type: 'integer',
          description: 'Current planning step number.',
          minimum: 1,
        },
        totalSteps: {
          type: 'integer',
          description: 'Current estimate of total planning steps.',
          minimum: 1,
        },
        isRevision: {
          type: 'boolean',
          description: 'Whether this step revises a previous step.',
        },
        revisesStep: {
          type: 'integer',
          description: 'If revising, which step number is being revised.',
          minimum: 1,
        },
        branchFromStep: {
          type: 'integer',
          description: 'If branching, which step number this branch starts from.',
          minimum: 1,
        },
        branchId: {
          type: 'string',
          description: 'Identifier for the branch.',
        },
        needsMoreSteps: {
          type: 'boolean',
          description:
            'Set true when you reached the estimated end but realized more planning is required.',
        },
      },
      required: ['step', 'nextStepNeeded', 'stepNumber', 'totalSteps'],
    },
  };

  private stepHistory: PlanStepInput[] = [];
  private branches: Record<string, PlanStepInput[]> = {};

  public execute(rawInput: unknown): PlanStepResult {
    const input = planStepInputSchema.parse(rawInput);
    const normalized: PlanStepInput = {
      ...input,
      totalSteps: Math.max(input.totalSteps, input.stepNumber),
    };

    this.stepHistory.push(normalized);

    if (normalized.branchFromStep !== undefined && normalized.branchId !== undefined) {
      if (!this.branches[normalized.branchId]) {
        this.branches[normalized.branchId] = [];
      }
      this.branches[normalized.branchId].push(normalized);
    }

    return {
      stepNumber: normalized.stepNumber,
      totalSteps: normalized.totalSteps,
      nextStepNeeded: normalized.nextStepNeeded,
      branches: Object.keys(this.branches),
      stepHistoryLength: this.stepHistory.length,
    };
  }

  public reset(): void {
    this.stepHistory = [];
    this.branches = {};
  }
}
