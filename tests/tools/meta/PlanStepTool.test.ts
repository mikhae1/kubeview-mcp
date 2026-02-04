import { PlanStepTool } from '../../../src/tools/meta/PlanStepTool';

describe('PlanStepTool', () => {
  it('records planning steps and returns progress metadata', () => {
    const tool = new PlanStepTool();

    const result = tool.execute({
      step: 'Check pod health first',
      nextStepNeeded: true,
      stepNumber: 1,
      totalSteps: 3,
    });

    expect(result).toEqual({
      stepNumber: 1,
      totalSteps: 3,
      nextStepNeeded: true,
      branches: [],
      stepHistoryLength: 1,
    });
  });

  it('expands totalSteps when stepNumber exceeds the estimate', () => {
    const tool = new PlanStepTool();

    const result = tool.execute({
      step: 'Continue deeper diagnosis',
      nextStepNeeded: true,
      stepNumber: 4,
      totalSteps: 2,
    });

    expect(result.totalSteps).toBe(4);
  });

  it('tracks branch ids when branch metadata is present', () => {
    const tool = new PlanStepTool();

    const result = tool.execute({
      step: 'Try alternate hypothesis',
      nextStepNeeded: true,
      stepNumber: 2,
      totalSteps: 3,
      branchFromStep: 1,
      branchId: 'alt-path',
    });

    expect(result.branches).toEqual(['alt-path']);
  });

  it('supports reset to clear stored state', () => {
    const tool = new PlanStepTool();

    tool.execute({
      step: 'Initial step',
      nextStepNeeded: true,
      stepNumber: 1,
      totalSteps: 1,
    });

    tool.reset();

    const result = tool.execute({
      step: 'New conversation step',
      nextStepNeeded: false,
      stepNumber: 1,
      totalSteps: 1,
    });

    expect(result.stepHistoryLength).toBe(1);
    expect(result.branches).toEqual([]);
  });

  it('exposes integer schema metadata for step counters', () => {
    const tool = new PlanStepTool();
    const properties = tool.tool.inputSchema.properties as Record<string, { type: string }>;

    expect(properties.stepNumber.type).toBe('integer');
    expect(properties.totalSteps.type).toBe('integer');
    expect(properties.revisesStep.type).toBe('integer');
    expect(properties.branchFromStep.type).toBe('integer');
  });

  it('rejects invalid revision metadata', () => {
    const tool = new PlanStepTool();

    expect(() =>
      tool.execute({
        step: 'Revise previous logic',
        nextStepNeeded: true,
        stepNumber: 2,
        totalSteps: 3,
        isRevision: true,
      }),
    ).toThrow('revisesStep is required when isRevision is true');
  });
});
