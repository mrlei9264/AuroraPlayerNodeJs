export const MAGNETIC_MOTION_DURATION = 0.48
export const MAGNETIC_MOTION_EASE = [0.16, 1, 0.3, 1] as const

export const MAGNETIC_INDICATOR_TRANSITION = {
  type: 'spring' as const,
  stiffness: 235,
  damping: 24,
  mass: 0.9,
}

export const MAGNETIC_BUTTON_TRANSITION = {
  duration: MAGNETIC_MOTION_DURATION,
  times: [0, 0.56, 0.82, 1],
  ease: MAGNETIC_MOTION_EASE,
}

export const MAGNETIC_ICON_TRANSITION = {
  duration: MAGNETIC_MOTION_DURATION,
  times: [0, 0.56, 0.76, 1],
  ease: MAGNETIC_MOTION_EASE,
}

export function magneticButtonInitial(direction: number) {
  return { y: direction * -9, scale: 0.96 }
}

export function magneticButtonAnimate(direction: number) {
  return {
    y: [direction * -9, direction * 2, direction * -1, 0],
    scale: [0.96, 1.07, 0.99, 1],
  }
}

export function magneticIconInitial(direction: number) {
  return { y: direction * -6, scale: 0.96 }
}

export function magneticIconAnimate(direction: number) {
  return {
    y: [direction * -6, direction * 1.5, direction * -0.5, 0],
    scale: [0.96, 1.05, 0.995, 1],
  }
}
