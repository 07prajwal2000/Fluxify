import React from "react";
import { Stepper, Button, Group, Paper, Box } from "@mantine/core";

export interface OnboardingStep {
  label: string;
  description?: string;
  content: React.ReactNode;
  /** Return true if the step is valid and we can proceed to next step */
  validate?: () => boolean | Promise<boolean>;
  /** Optional icon for the step */
  icon?: React.ReactNode;
}

interface OnboardingStepperProps {
  steps: OnboardingStep[];
  activeStep: number;
  onStepChange: (step: number) => void;
  onSubmit: () => void;
  readOnly?: boolean;
  loading?: boolean;
  onCancel?: () => void;
}

export const OnboardingStepper: React.FC<OnboardingStepperProps> = ({
  steps,
  activeStep,
  onStepChange,
  onSubmit,
  readOnly,
  loading,
  onCancel,
}) => {
  const handleNext = async () => {
    const currentStepDef = steps[activeStep];
    if (currentStepDef.validate) {
      const isValid = await currentStepDef.validate();
      if (!isValid) return;
    }
    
    if (activeStep === steps.length - 1) {
      onSubmit();
    } else {
      onStepChange(activeStep + 1);
    }
  };

  const handlePrev = () => {
    onStepChange(activeStep - 1);
  };

  const isSummaryStep = activeStep === steps.length - 1;

  if (readOnly) {
    // In read-only mode, we usually just want to display the summary or the specific step's content without navigation.
    return (
      <Paper p="xl" radius="md">
        <Box mb="xl">{steps[activeStep].content}</Box>
      </Paper>
    );
  }

  return (
    <Box>
      <Stepper
        active={activeStep}
        onStepClick={onStepChange}
        color="violet"
        allowNextStepsSelect={false}
      >
        {steps.map((step, index) => (
          <Stepper.Step
            key={index}
            label={step.label}
            description={step.description}
            icon={step.icon}
          />
        ))}
      </Stepper>

      <Paper p="md" radius="md" mt="md" style={{ flex: 1, paddingBottom: 80 }}>
        <Box style={{ minHeight: "300px" }}>
          {steps[activeStep].content}
        </Box>
      </Paper>

      <Group 
        justify="space-between" 
        p="md" 
        style={{ 
          position: "sticky", 
          bottom: 0, 
          backgroundColor: "var(--mantine-color-body)", 
          borderTop: "1px solid var(--mantine-color-gray-2)",
          zIndex: 10 
        }}
      >
        <Group>
          {onCancel && (
            <Button variant="subtle" color="dark" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            variant="default"
            onClick={handlePrev}
            disabled={activeStep === 0}
          >
            Back
          </Button>
        </Group>
        <Button
          onClick={handleNext}
          color="violet"
          loading={loading}
        >
          {isSummaryStep ? "Submit" : "Next step"}
        </Button>
      </Group>
    </Box>
  );
};
