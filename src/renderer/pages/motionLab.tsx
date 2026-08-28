import React, { useEffect, useMemo, useState } from 'react'
import { motion, useReducedMotion, type TargetAndTransition } from 'motion/react'
import { Icon, type IconName } from '../core/icons'
import {
  MAGNETIC_BUTTON_TRANSITION,
  MAGNETIC_ICON_TRANSITION,
  MAGNETIC_INDICATOR_TRANSITION,
  magneticButtonAnimate,
  magneticButtonInitial,
  magneticIconAnimate,
  magneticIconInitial,
} from '../core/navigationMotion'
import '../styles/motion-lab.css'

type EffectId = 'path' | 'relay' | 'nucleus' | 'liquid' | 'geometry' | 'semantic' | 'mask' | 'magnetic' | 'echo' | 'topology'

type EffectDefinition = {
  id: EffectId
  name: string
  shortName: string
  description: string
  principle: string
}

const NAV_ITEMS: Array<{ icon: IconName; label: string }> = [
  { icon: 'home', label: '主页' },
  { icon: 'library', label: '媒体库' },
  { icon: 'cast', label: '网络媒体' },
  { icon: 'settings', label: '设置' },
]

const EFFECTS: EffectDefinition[] = [
  {
    id: 'path',
    name: '连续路径变形',
    shortName: '路径变形',
    description: '旧图标的描边收回，新图标从同一个视觉锚点重新绘制。',
    principle: '轮廓连续，方向明确',
  },
  {
    id: 'relay',
    name: '线条接力',
    shortName: '线条接力',
    description: '图标熄灭后，一束细线沿导航轨道抵达目标，再点亮新图标。',
    principle: '克制，适合正式产品',
  },
  {
    id: 'nucleus',
    name: '圆形核心重组',
    shortName: '核心重组',
    description: '图标收进发光核心，核心移动后按照目标图标的结构向外展开。',
    principle: '统一不同图标的拓扑',
  },
  {
    id: 'liquid',
    name: '液态轮廓转换',
    shortName: '液态轮廓',
    description: '高亮轮廓被移动方向拉长，在目标位置恢复为稳定圆形。',
    principle: '流体感最强',
  },
  {
    id: 'geometry',
    name: '几何拆解与重组',
    shortName: '几何重组',
    description: '旧图标拆成四个基础碎片，碎片汇聚后组成新的图标。',
    principle: '结构化，科技感明显',
  },
  {
    id: 'semantic',
    name: '图标语义动画',
    shortName: '语义动画',
    description: '主页落下、书页展开、信号扩散、齿轮旋转，各自表达真实含义。',
    principle: '辨识度最高',
  },
  {
    id: 'mask',
    name: '圆形遮罩吞吐',
    shortName: '遮罩吞吐',
    description: '圆形遮罩吞掉旧图标，移动到目标后再次打开并释放新图标。',
    principle: '稳定，几乎不产生伪影',
  },
  {
    id: 'magnetic',
    name: '磁性吸附',
    shortName: '磁性吸附',
    description: '目标图标先被高亮吸引，接触后压缩并完成弹性归位。',
    principle: '反馈直接，触感鲜明',
  },
  {
    id: 'echo',
    name: '残影传递',
    shortName: '残影传递',
    description: '透明轮廓沿轨道依次传递，最前方残影凝聚成目标图标。',
    principle: '速度感清晰',
  },
  {
    id: 'topology',
    name: '节点拓扑变换',
    shortName: '节点拓扑',
    description: '节点脱离旧结构，围绕目标重新连接，最后显现完整图标。',
    principle: '视觉最独特，实现成本最高',
  },
]

function getIconMotion(effect: EffectId, icon: IconName, direction: number, reduced: boolean): { initial: false | TargetAndTransition; animate: TargetAndTransition } {
  if (reduced) return { initial: false as const, animate: { opacity: 1 } }

  if (effect === 'semantic') {
    if (icon === 'home') return { initial: { opacity: 0, y: -10, scale: 0.9 }, animate: { opacity: [0, 1, 1], y: [-10, 3, 0], scale: [0.9, 1.06, 1] } }
    if (icon === 'library') return { initial: { opacity: 0, scaleX: 0.45 }, animate: { opacity: [0, 1, 1], scaleX: [0.45, 1.14, 1] } }
    if (icon === 'cast') return { initial: { opacity: 0, scale: 0.55 }, animate: { opacity: [0, 0.7, 1], scale: [0.55, 1.18, 1] } }
    return { initial: { opacity: 0, rotate: -70, scale: 0.78 }, animate: { opacity: 1, rotate: [-70, 14, 0], scale: [0.78, 1.06, 1] } }
  }

  const variants: Record<EffectId, { initial: TargetAndTransition; animate: TargetAndTransition }> = {
    path: { initial: { opacity: 0, scale: 0.8 }, animate: { opacity: 1, scale: [0.8, 1.06, 1] } },
    relay: { initial: { opacity: 0, scale: 0.65 }, animate: { opacity: [0, 0, 1], scale: [0.65, 0.65, 1] } },
    nucleus: { initial: { opacity: 0, scale: 0 }, animate: { opacity: [0, 0.2, 1], scale: [0, 0.28, 1.08, 1] } },
    liquid: { initial: { opacity: 0, scaleY: 0.5 }, animate: { opacity: [0, 0.4, 1], scaleY: [0.5, 1.15, 1] } },
    geometry: { initial: { opacity: 0, rotate: direction * -25, scale: 0.6 }, animate: { opacity: [0, 0, 1], rotate: [direction * -25, 0], scale: [0.6, 0.8, 1] } },
    semantic: { initial: {}, animate: {} },
    mask: { initial: { opacity: 0, scale: 0.6 }, animate: { opacity: [0, 0, 1], scale: [0.6, 0.6, 1] } },
    magnetic: { initial: magneticIconInitial(direction), animate: magneticIconAnimate(direction) },
    echo: { initial: { opacity: 0, scale: 0.72 }, animate: { opacity: [0, 0.25, 1], scale: [0.72, 0.9, 1] } },
    topology: { initial: { opacity: 0, rotate: direction * -32, scale: 0.5 }, animate: { opacity: [0, 0, 1], rotate: [direction * -32, 0], scale: [0.5, 0.72, 1] } },
  }
  return variants[effect]
}

function IndicatorDecor({ effect }: { effect: EffectId }) {
  if (effect === 'nucleus') return <span className="lab-nucleus" />
  if (effect === 'geometry') return <span className="lab-shards">{Array.from({ length: 4 }, (_, index) => <i key={index} />)}</span>
  if (effect === 'topology') return <span className="lab-nodes">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</span>
  return null
}

function TransitionTrail({ effect, previous, active, cycle, reduced }: { effect: EffectId; previous: number; active: number; cycle: number; reduced: boolean }) {
  if (reduced || previous === active) return null
  const from = previous * 58 + 24
  const to = active * 58 + 24

  if (effect === 'relay') {
    return (
      <motion.span
        key={`relay-${cycle}`}
        className="lab-relay-runner"
        initial={{ y: from, opacity: 0, scaleY: 0.4 }}
        animate={{ y: [from, from, to, to], opacity: [0, 1, 1, 0], scaleY: [0.4, 1.7, 0.7, 0.2] }}
        transition={{ duration: 0.68, times: [0, 0.18, 0.72, 1], ease: [0.22, 0.8, 0.2, 1] }}
      />
    )
  }

  if (effect === 'echo') {
    return (
      <>
        {[0, 1, 2].map((index) => (
          <motion.span
            key={`echo-${cycle}-${index}`}
            className="lab-echo"
            initial={{ y: from, opacity: 0, scale: 0.72 }}
            animate={{ y: to, opacity: [0, 0.42 - index * 0.09, 0], scale: [0.72, 0.92, 0.58] }}
            transition={{ duration: 0.54, delay: index * 0.055, ease: [0.22, 0.8, 0.2, 1] }}
          />
        ))}
      </>
    )
  }

  return null
}

function DemoRail({ effect, replay }: { effect: EffectDefinition; replay: number }) {
  const prefersReducedMotion = useReducedMotion()
  const reduced = Boolean(prefersReducedMotion)
  const [active, setActive] = useState(0)
  const [previous, setPrevious] = useState(0)
  const [cycle, setCycle] = useState(0)
  const direction = active === previous ? 1 : Math.sign(active - previous)

  useEffect(() => {
    if (replay === 0) return
    setActive((current) => {
      setPrevious(current)
      return (current + 1) % NAV_ITEMS.length
    })
    setCycle((current) => current + 1)
  }, [replay])

  const choose = (index: number) => {
    if (index === active) return
    setPrevious(active)
    setActive(index)
    setCycle((current) => current + 1)
  }

  const indicatorTransition = reduced
    ? { duration: 0 }
    : effect.id === 'magnetic'
      ? MAGNETIC_INDICATOR_TRANSITION
      : effect.id === 'liquid'
        ? { duration: 0.7, ease: [0.2, 0.84, 0.18, 1] as const }
        : { duration: 0.56, ease: [0.22, 0.8, 0.2, 1] as const }

  return (
    <div className={`lab-preview effect-${effect.id}`} style={{ '--direction': direction } as React.CSSProperties}>
      <div className="lab-rail" aria-label={`${effect.name}演示导航`}>
        <span className="lab-track" aria-hidden="true" />
        <TransitionTrail effect={effect.id} previous={previous} active={active} cycle={cycle} reduced={reduced} />
        <motion.span
          key={`indicator-${effect.id}-${cycle}`}
          className="lab-indicator"
          initial={reduced ? { y: active * 58 } : { y: previous * 58, scale: effect.id === 'mask' ? 0.3 : 1 }}
          animate={reduced ? { y: active * 58 } : { y: active * 58, scale: effect.id === 'mask' ? [0.3, 1.2, 1] : 1 }}
          transition={indicatorTransition}
          aria-hidden="true"
        >
          <IndicatorDecor effect={effect.id} />
        </motion.span>
        <div className="lab-buttons">
          {NAV_ITEMS.map((item, index) => {
            const isActive = index === active
            const isPrevious = index === previous && previous !== active
            const iconMotion = getIconMotion(effect.id, item.icon, direction, reduced)
            return (
              <motion.button
                type="button"
                key={item.icon}
                className={`lab-nav-button ${isActive ? 'is-active' : ''} ${isPrevious ? 'is-previous' : ''}`}
                aria-label={item.label}
                aria-pressed={isActive}
                title={item.label}
                onClick={() => choose(index)}
                initial={effect.id === 'magnetic' && isActive && !reduced ? magneticButtonInitial(direction) : false}
                animate={effect.id === 'magnetic' && isActive && !reduced ? magneticButtonAnimate(direction) : { y: 0, scale: 1 }}
                transition={effect.id === 'magnetic' && isActive && !reduced ? MAGNETIC_BUTTON_TRANSITION : { duration: 0.08 }}
              >
                {isActive ? (
                  <motion.span
                    key={`${effect.id}-${item.icon}-${cycle}`}
                    className="lab-icon"
                    initial={iconMotion.initial}
                    animate={iconMotion.animate}
                    transition={effect.id === 'magnetic' && !reduced
                      ? MAGNETIC_ICON_TRANSITION
                      : { duration: reduced ? 0 : 0.62, times: [0, 0.35, 0.72, 1], ease: [0.22, 0.8, 0.2, 1] }}
                  >
                    <Icon name={item.icon} size={25} strokeWidth={1.7} />
                  </motion.span>
                ) : (
                  <span className="lab-icon"><Icon name={item.icon} size={25} strokeWidth={1.7} /></span>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>
      <div className="lab-active-copy" aria-live="polite">
        <span>{NAV_ITEMS[active].label}</span>
        <small>{effect.shortName}</small>
      </div>
    </div>
  )
}

function DemoCard({ effect, replay, index }: { effect: EffectDefinition; replay: number; index: number }) {
  return (
    <motion.article
      className="lab-card"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.48, delay: index * 0.035, ease: [0.16, 1, 0.3, 1] }}
    >
      <DemoRail effect={effect} replay={replay} />
      <div className="lab-card-copy">
        <h2>{effect.name}</h2>
        <p>{effect.description}</p>
        <span>{effect.principle}</span>
      </div>
    </motion.article>
  )
}

export function MotionLabPage() {
  const [replay, setReplay] = useState(0)
  const title = useMemo(() => `导航动效实验室 | Aurora Player`, [])

  useEffect(() => {
    const previousTitle = document.title
    document.title = title
    return () => { document.title = previousTitle }
  }, [title])

  return (
    <main className="motion-lab">
      <header className="lab-header">
        <div>
          <span className="lab-eyebrow">Aurora Player Motion Lab</span>
          <h1>十种图标切换语言</h1>
          <p>点击任意图标单独比较，或让全部方案同时切到下一项。</p>
        </div>
        <button type="button" className="lab-replay" onClick={() => setReplay((current) => current + 1)}>
          <Icon name="refresh" size={18} />
          全部切换
        </button>
      </header>

      <section className="lab-grid" aria-label="导航动画方案">
        {EFFECTS.map((effect, index) => <DemoCard key={effect.id} effect={effect} replay={replay} index={index} />)}
      </section>
    </main>
  )
}
