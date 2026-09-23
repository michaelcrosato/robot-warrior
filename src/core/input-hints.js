/** Format hints locally so a co-op host never chooses another pilot's control scheme. */
export function inputHint(text, touch) {
  if (!touch) return text;
  for (const [keyboard, mobile] of [
    [
      '[B] Full throttle. [R] Select target. [I] Enhanced Imaging.',
      'Move with the left thumb. Hold FIRE and drag to aim.',
    ],
    ['Press G to release coolant.', 'Open SYS for coolant.'],
    ['Press I for Enhanced Imaging.', 'Open SYS for Enhanced Imaging.'],
    ['ENHANCED IMAGING / ON · [I] Normal view', 'ENHANCED IMAGING / ON'],
    [
      'Set speed with W or B. Use A and D to turn. Press X to stop.',
      'Drag MOVE to walk and turn. Release to stop.',
    ],
    ['PRESS X TO STOP', 'RELEASE MOVE TO STOP'],
    ['Hold J to restore a downed teammate.', 'Stop near a downed teammate to restore them.'],
    ['Hold J nearby to restore the mech.', 'Stop nearby to restore the mech.'],
  ])
    text = text.replace(keyboard, mobile);
  return text;
}
