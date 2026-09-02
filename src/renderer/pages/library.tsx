import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { p, useRuntime } from '../core/runtime'
import { FilledIcon, Icon, type IconName } from '../core/icons'
import { coverUrl } from '../core/player'
import type { MediaItem } from '../../shared/types'
import { I } from '../../shared/channels'
import { collectSimilarVideos } from './libraryCollections'
import { AudioArtwork } from './mediaArtwork'
import { FloatingMenu } from '../shared/floatingMenu'

type MediaKind = 'video' | 'audio'
type LibraryTab = 'favorite' | MediaKind
type ViewMode = 'grid' | 'list'
type SortBy = 'added' | 'name' | 'size' | 'duration'
type SortDirection = 'asc' | 'desc'

type LibrarySortPreference = { sortBy: SortBy; sortDirection: SortDirection }
type ManualCollection = { id: string; title: string; mediaIds: number[] }
type LibraryCollectionPreference = { manual: ManualCollection[]; excludedAutoIds: string[] }

const LIBRARY_SORT_STORAGE_KEY = 'aurora.library.sort.v1'
const LIBRARY_COLLECTION_STORAGE_KEY = 'aurora.library.collections.v1'
const LIBRARY_VIEW_STORAGE_KEY = 'aurora.library.view.v1'
const LIBRARY_GRID_CARD_WIDTH = 220
const LIBRARY_GRID_COLUMN_GAP = 17
const LIBRARY_GRID_SELECTION_GAP = 14
const DEFAULT_LIBRARY_GRID_COLUMNS = 4

function readLibraryViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(LIBRARY_VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

function readLibrarySortPreference(): LibrarySortPreference {
  const fallback: LibrarySortPreference = { sortBy: 'added', sortDirection: 'desc' }
  try {
    const stored = window.localStorage.getItem(LIBRARY_SORT_STORAGE_KEY)
    if (!stored) return fallback
    const parsed = JSON.parse(stored) as Partial<LibrarySortPreference>
    const sortBy = parsed.sortBy === 'added' || parsed.sortBy === 'name' || parsed.sortBy === 'size' || parsed.sortBy === 'duration'
      ? parsed.sortBy
      : fallback.sortBy
    const sortDirection = parsed.sortDirection === 'asc' || parsed.sortDirection === 'desc'
      ? parsed.sortDirection
      : fallback.sortDirection
    return { sortBy, sortDirection }
  } catch {
    return fallback
  }
}

function readLibraryCollectionPreference(): LibraryCollectionPreference {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LIBRARY_COLLECTION_STORAGE_KEY) || '{}') as Partial<LibraryCollectionPreference>
    return {
      manual: Array.isArray(parsed.manual)
        ? parsed.manual.filter((item): item is ManualCollection => !!item && typeof item.id === 'string' && typeof item.title === 'string' && Array.isArray(item.mediaIds))
        : [],
      excludedAutoIds: Array.isArray(parsed.excludedAutoIds) ? parsed.excludedAutoIds.filter((id): id is string => typeof id === 'string') : []
    }
  } catch {
    return { manual: [], excludedAutoIds: [] }
  }
}

function pruneCollectionPreference(current: LibraryCollectionPreference, items: MediaItem[]): LibraryCollectionPreference {
  const availableMediaIds = new Set(items.filter((item) => !item.isImage).map((item) => item.id))
  const availableAutoCollectionIds = new Set(collectSimilarVideos(
    items.filter((item) => !item.isAudio && !item.isImage)
  ).map((collection) => collection.id))
  const manual = current.manual
    .map((collection) => ({ ...collection, mediaIds: collection.mediaIds.filter((id) => availableMediaIds.has(id)) }))
    .filter((collection) => collection.mediaIds.length >= 2)
  const excludedAutoIds = current.excludedAutoIds.filter((id) => availableAutoCollectionIds.has(id))
  const manualUnchanged = manual.length === current.manual.length && manual.every((collection, index) => {
    const previous = current.manual[index]
    return collection.id === previous.id && collection.title === previous.title &&
      collection.mediaIds.length === previous.mediaIds.length && collection.mediaIds.every((id, mediaIndex) => id === previous.mediaIds[mediaIndex])
  })
  const exclusionsUnchanged = excludedAutoIds.length === current.excludedAutoIds.length &&
    excludedAutoIds.every((id, index) => id === current.excludedAutoIds[index])
  return manualUnchanged && exclusionsUnchanged ? current : { manual, excludedAutoIds }
}

type LibraryCardData = {
  kind: MediaKind
  title: string
  artwork: string | null
  overlayDuration: string
  metadata: string
  item: MediaItem
}

type LibraryMetric = {
  label: string
  icon: IconName
  value?: string
  suffix?: string
  duration?: number
  detail?: string
}

type LibraryDisplayEntry =
  | { type: 'item'; card: LibraryCardData }
  | { type: 'collection'; id: string; title: string; cards: LibraryCardData[]; source: 'auto' | 'manual' }

type LibraryVirtualEntry = { entry: LibraryDisplayEntry; index: number }
type LibraryVirtualRow = { key: string; entries: LibraryVirtualEntry[]; expanded: boolean }

function displayEntryKey(entry: LibraryDisplayEntry): string {
  return entry.type === 'item' ? `item-${entry.card.item.id}` : `collection-${entry.id}`
}

function buildVirtualRows(entries: LibraryDisplayEntry[], columns: number, expandedCollections: Set<string>): LibraryVirtualRow[] {
  const rows: LibraryVirtualRow[] = []
  let pending: LibraryVirtualEntry[] = []
  const flush = () => {
    if (!pending.length) return
    rows.push({ key: pending.map(({ entry }) => displayEntryKey(entry)).join('|'), entries: pending, expanded: false })
    pending = []
  }
  entries.forEach((entry, index) => {
    const expanded = entry.type === 'collection' && expandedCollections.has(entry.id)
    if (expanded) {
      flush()
      rows.push({ key: `expanded-${entry.id}`, entries: [{ entry, index }], expanded: true })
      return
    }
    pending.push({ entry, index })
    if (pending.length >= columns) flush()
  })
  flush()
  return rows
}

function formatOverlayDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function formatCompactDuration(seconds: number, hour: string, minute: string): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const totalMinutes = Math.round(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return minutes > 0 ? `${hours}${hour} ${minutes}${minute}` : `${hours}${hour}`
  return `${Math.max(1, minutes)}${minute}`
}

function AggregateDuration({ seconds, hour, minute }: { seconds: number; hour: string; minute: string }) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return <><strong>0</strong><span>{minute}</span></>
  }
  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return (
    <>
      {hours > 0 && <><strong>{hours}</strong><span>{hour}</span></>}
      <strong>{minutes}</strong><span>{minute}</span>
    </>
  )
}

function titleFor(item: MediaItem): string {
  return item.title || item.fileName
}

function metadataFor(item: MediaItem, unknownArtist: string, video: string, hour: string, minute: string): string {
  if (item.isAudio) {
    const artist = item.artist || unknownArtist
    return item.album ? `${artist} · ${item.album}` : artist
  }
  const duration = formatCompactDuration(item.duration, hour, minute)
  return duration ? `${duration} · ${video}` : video
}

function LibrarySortSelect({
  value,
  direction,
  options,
  label,
  ascendingLabel,
  descendingLabel,
  onChange,
  onDirectionChange
}: {
  value: SortBy
  direction: SortDirection
  options: Array<{ value: SortBy; label: string }>
  label: string
  ascendingLabel: string
  descendingLabel: string
  onChange: (value: SortBy) => void
  onDirectionChange: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value))
  const selected = options[selectedIndex] ?? options[0]

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => optionRefs.current[selectedIndex]?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open, selectedIndex])

  const choose = (nextValue: SortBy) => {
    onChange(nextValue)
    setOpen(false)
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveOptionFocus = (currentIndex: number, offset: number) => {
    const nextIndex = (currentIndex + offset + options.length) % options.length
    optionRefs.current[nextIndex]?.focus()
  }

  return (
    <div className="library-sort-select" ref={rootRef} data-open={open ? 'true' : 'false'}>
      <button
        ref={triggerRef}
        type="button"
        className="library-sort-trigger"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((visible) => !visible)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
          }
          if (event.key === 'Escape') setOpen(false)
        }}
      >
        <Icon name="sliders" size={17} />
        <span className="library-sort-value">{selected?.label ?? ''}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} />
      </button>
      <button
        type="button"
        className={`library-sort-direction ${direction}`}
        onClick={onDirectionChange}
        aria-label={direction === 'asc' ? ascendingLabel : descendingLabel}
        title={direction === 'asc' ? ascendingLabel : descendingLabel}
      >
        <Icon name="up" size={17} />
      </button>
      <FloatingMenu
        open={open}
        anchorRef={rootRef}
        onClose={() => setOpen(false)}
        className="settings-font-menu settings-select-menu library-sort-menu"
        role="listbox"
        ariaLabel={label}
        align="end"
        width={196}
        gap={5}
      >
          {options.map((option, index) => (
            <button
              ref={(node) => { optionRefs.current[index] = node }}
              type="button"
              role="option"
              aria-selected={value === option.value}
              className={value === option.value ? 'selected' : ''}
              key={option.value}
              onClick={() => choose(option.value)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); moveOptionFocus(index, 1) }
                if (event.key === 'ArrowUp') { event.preventDefault(); moveOptionFocus(index, -1) }
                if (event.key === 'Home') { event.preventDefault(); optionRefs.current[0]?.focus() }
                if (event.key === 'End') { event.preventDefault(); optionRefs.current[options.length - 1]?.focus() }
                if (event.key === 'Escape') { event.preventDefault(); setOpen(false); triggerRef.current?.focus() }
              }}
            >
              <span className="settings-select-option-main"><span>{option.label}</span></span>
              {value === option.value && <Icon name="check" size={15} />}
            </button>
          ))}
      </FloatingMenu>
    </div>
  )
}

function LibraryFilterControls({
  kind,
  query,
  compact,
  favorites,
  videos,
  audios,
  locale,
  mediaTypeLabel,
  favoritesLabel,
  videosLabel,
  audiosLabel,
  searchLabel,
  onKindChange,
  onQueryChange
}: {
  kind: LibraryTab
  query: string
  compact?: boolean
  favorites: number
  videos: number
  audios: number
  locale: string
  mediaTypeLabel: string
  favoritesLabel: string
  videosLabel: string
  audiosLabel: string
  searchLabel: string
  onKindChange: (kind: LibraryTab) => void
  onQueryChange: (query: string) => void
}) {
  const tabs = [
    ['favorite', favoritesLabel, favorites],
    ['video', videosLabel, videos],
    ['audio', audiosLabel, audios]
  ] as const
  return (
    <div className={`library-filter-row ${compact ? 'compact' : ''}`}>
      <div className="library-type-tabs" role="tablist" aria-label={mediaTypeLabel}>
        {tabs.map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            className={kind === value ? 'active' : ''}
            role="tab"
            aria-selected={kind === value}
            onClick={() => onKindChange(value)}
          >
            {compact ? label : `${label} (${count.toLocaleString(locale)})`}
          </button>
        ))}
      </div>
      <label className="library-search">
        <Icon name="search" size={compact ? 17 : 21} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={searchLabel}
          aria-label={searchLabel}
        />
      </label>
    </div>
  )
}

export function LibraryPage() {
  const { t, settings, library, session, play, addMediaDialog, enqueue, toggleFavorite, removeMedia, confirm, prompt, openPath, openCtxMenu, navigate } = useRuntime()
  const locale = settings?.language === 'zh' ? 'zh-CN' : 'en-US'
  const reduceMotion = useReducedMotion()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<LibraryTab>('favorite')
  const [view, setView] = useState<ViewMode>(readLibraryViewMode)
  const [viewHasChanged, setViewHasChanged] = useState(false)
  const [sortPreference, setSortPreference] = useState<LibrarySortPreference>(readLibrarySortPreference)
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(() => new Set())
  const [collectionPreference, setCollectionPreference] = useState<LibraryCollectionPreference>(readLibraryCollectionPreference)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<number>>(() => new Set())
  const pageRef = useRef<HTMLElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const toolbarSentinelRef = useRef<HTMLDivElement>(null)
  const viewAnimationTimerRef = useRef(0)
  const viewAnchorMediaIdRef = useRef<number | null>(null)
  const locatedMediaIdRef = useRef<number | null>(null)
  const collectionCleanupReadyRef = useRef(false)
  const [toolbarStuck, setToolbarStuck] = useState(false)
  const [gridWidth, setGridWidth] = useState(0)
  const [gridScrollMargin, setGridScrollMargin] = useState(0)
  const { sortBy, sortDirection } = sortPreference

  useEffect(() => {
    const root = pageRef.current
    const sentinel = toolbarSentinelRef.current
    if (!root || !sentinel) return
    const observer = new IntersectionObserver(([entry]) => {
      const rootTop = entry.rootBounds?.top ?? root.getBoundingClientRect().top
      setToolbarStuck(!entry.isIntersecting && entry.boundingClientRect.top <= rootTop)
    }, { root, threshold: 0 })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(LIBRARY_SORT_STORAGE_KEY, JSON.stringify(sortPreference))
    } catch {
      // Local storage can be unavailable in hardened or private renderer contexts.
    }
  }, [sortPreference])

  useEffect(() => {
    try { window.localStorage.setItem(LIBRARY_COLLECTION_STORAGE_KEY, JSON.stringify(collectionPreference)) } catch { /* optional renderer storage */ }
  }, [collectionPreference])

  useEffect(() => {
    const available = new Set(library.map((item) => item.id))
    setSelectedMediaIds((current) => new Set([...current].filter((id) => available.has(id))))
    if (collectionCleanupReadyRef.current) {
      setCollectionPreference((current) => pruneCollectionPreference(current, library))
    }
  }, [library])

  useEffect(() => {
    let active = true
    void p<MediaItem[]>(I.libraryGet).then((items) => {
      if (!active) return
      setCollectionPreference((current) => pruneCollectionPreference(current, items))
      collectionCleanupReadyRef.current = true
    }).catch(() => {
      if (active) collectionCleanupReadyRef.current = true
    })
    return () => { active = false }
  }, [])

  const cards = useMemo<LibraryCardData[]>(() => {
    const videos = library.filter((item) => !item.isAudio && !item.isImage)
    const audios = library.filter((item) => item.isAudio && !item.isImage)
    const toCard = (item: MediaItem, mediaKind: MediaKind): LibraryCardData => ({
      kind: mediaKind,
      item,
      title: titleFor(item),
      artwork: item.coverPath ? coverUrl(item.coverPath) : null,
      overlayDuration: formatOverlayDuration(item.duration),
      metadata: metadataFor(item, t('unknownArtist'), t('video'), t('shortHour'), t('shortMinute'))
    })

    return [
      ...videos.map((item) => toCard(item, 'video')),
      ...audios.map((item) => toCard(item, 'audio'))
    ]
  }, [library, t])

  const libraryStats = useMemo(() => {
    const media = library.filter((item) => !item.isImage)
    const videos = media.filter((item) => !item.isAudio)
    const audios = media.filter((item) => item.isAudio)
    const totalDuration = media.reduce((sum, item) => sum + Math.max(0, item.duration || 0), 0)
    const watchedDuration = media.reduce((sum, item) => {
      if (!Number.isFinite(item.duration) || item.duration <= 0) return sum
      return sum + Math.min(item.duration, Math.max(0, item.lastPosition || 0))
    }, 0)
    const watchedPercent = totalDuration > 0 ? (watchedDuration / totalDuration) * 100 : 0
    return {
      total: media.length,
      favorites: media.filter((item) => item.favorite).length,
      videos: videos.length,
      audios: audios.length,
      metrics: [
        { label: t('videos'), value: videos.length.toLocaleString(locale), suffix: t('files'), icon: 'video' as IconName },
        { label: t('audios'), value: audios.length.toLocaleString(locale), suffix: t('files'), icon: 'music' as IconName },
        { label: t('totalDuration'), duration: totalDuration, icon: 'clock' as IconName },
        { label: t('watchedDuration'), duration: watchedDuration, detail: `(${watchedPercent.toFixed(1)}%)`, icon: 'play' as IconName }
      ] satisfies LibraryMetric[]
    }
  }, [library, locale, t])

  const visibleCards = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    const filtered = cards.filter((card) => {
      if (kind === 'favorite' ? !card.item.favorite : card.kind !== kind) return false
      if (!needle) return true
      const itemText = `${card.item.fileName} ${card.item.artist} ${card.item.album}`
      return `${card.title} ${card.metadata} ${itemText}`.toLocaleLowerCase().includes(needle)
    })
    const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    const direction = sortDirection === 'asc' ? 1 : -1
    return filtered.sort((left, right) => {
      let comparison = 0
      if (sortBy === 'name') comparison = collator.compare(left.title, right.title)
      else if (sortBy === 'size') {
        const leftSize = left.item.fileSize ?? 0
        const rightSize = right.item.fileSize ?? 0
        if (leftSize <= 0 || rightSize <= 0) {
          if (leftSize <= 0 && rightSize > 0) return 1
          if (rightSize <= 0 && leftSize > 0) return -1
        }
        comparison = leftSize - rightSize
      } else if (sortBy === 'duration') comparison = left.item.duration - right.item.duration
      else comparison = left.item.addedAt - right.item.addedAt
      if (comparison === 0) comparison = left.item.id - right.item.id
      return comparison * direction
    })
  }, [cards, kind, locale, query, sortBy, sortDirection])

  const displayEntries = useMemo<LibraryDisplayEntry[]>(() => {
    const cardById = new Map(visibleCards.map((card) => [card.item.id, card]))
    const manualCollections = collectionPreference.manual.map((collection) => ({
      ...collection,
      source: 'manual' as const,
      cards: collection.mediaIds.map((id) => cardById.get(id)).filter((card): card is LibraryCardData => !!card)
    })).filter((collection) => collection.cards.length > 0)
    const manuallyGrouped = new Set(manualCollections.flatMap((collection) => collection.cards.map((card) => card.item.id)))
    const autoCollections = collectSimilarVideos(visibleCards
      .filter((card) => card.kind === 'video' && !manuallyGrouped.has(card.item.id))
      .map((card) => card.item)).map((collection) => ({
      ...collection,
      source: 'auto' as const,
      cards: collection.items.map((item) => cardById.get(item.id)).filter((card): card is LibraryCardData => !!card)
    })).filter((collection) => !collectionPreference.excludedAutoIds.includes(collection.id))
    const collections = [...manualCollections, ...autoCollections]
    const collectionByMediaId = new Map<number, (typeof collections)[number]>()
    collections.forEach((collection) => collection.cards.forEach((card) => collectionByMediaId.set(card.item.id, collection)))

    const emitted = new Set<string>()
    const entries: LibraryDisplayEntry[] = []
    for (const card of visibleCards) {
      const collection = collectionByMediaId.get(card.item.id)
      if (!collection) {
        entries.push({ type: 'item', card })
      } else if (!emitted.has(collection.id)) {
        emitted.add(collection.id)
        entries.push({ type: 'collection', id: collection.id, title: collection.title, cards: collection.cards, source: collection.source })
      }
    }
    return entries
  }, [collectionPreference, visibleCards])

  const gridColumnGap = selectionMode ? LIBRARY_GRID_SELECTION_GAP : LIBRARY_GRID_COLUMN_GAP
  const measuredGridWidth = gridWidth > 0
    ? gridWidth
    : LIBRARY_GRID_CARD_WIDTH * DEFAULT_LIBRARY_GRID_COLUMNS + gridColumnGap * (DEFAULT_LIBRARY_GRID_COLUMNS - 1)
  const columnCount = view === 'list'
    ? 1
    : Math.max(1, Math.floor((measuredGridWidth + gridColumnGap) / (LIBRARY_GRID_CARD_WIDTH + gridColumnGap)))
  const virtualRows = useMemo(
    () => buildVirtualRows(displayEntries, columnCount, expandedCollections),
    [columnCount, displayEntries, expandedCollections]
  )
  const estimateRowSize = useCallback((index: number) => {
    const row = virtualRows[index]
    if (view === 'list') {
      if (!row?.expanded) return selectionMode ? 110 : 113
      const collection = row.entries[0]?.entry
      const itemCount = collection?.type === 'collection' ? collection.cards.length : 0
      return 126 + itemCount * (selectionMode ? 110 : 113)
    }
    const rowGap = selectionMode ? 25 : 30
    const cardHeight = LIBRARY_GRID_CARD_WIDTH * (166 / 252) + 70
    if (!row?.expanded) return cardHeight + rowGap
    const collection = row.entries[0]?.entry
    const itemCount = collection?.type === 'collection' ? collection.cards.length : 0
    return Math.max(240, Math.max(gridWidth, 760) * (166 / 252) + 70) + Math.ceil(itemCount / columnCount) * (cardHeight + rowGap) + 48
  }, [columnCount, gridWidth, selectionMode, view, virtualRows])
  const getVirtualRowKey = useCallback((index: number) => virtualRows[index]?.key ?? index, [virtualRows])
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: virtualRows.length,
    getScrollElement: () => pageRef.current,
    estimateSize: estimateRowSize,
    getItemKey: getVirtualRowKey,
    overscan: view === 'list' ? 8 : 3,
    scrollMargin: gridScrollMargin
  })

  useLayoutEffect(() => {
    const page = pageRef.current
    const grid = gridRef.current
    if (!page || !grid) return
    const updateLayout = () => {
      const nextWidth = grid.clientWidth
      const nextMargin = grid.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop
      setGridWidth((current) => Math.abs(current - nextWidth) > 0.5 ? nextWidth : current)
      setGridScrollMargin((current) => Math.abs(current - nextMargin) > 0.5 ? nextMargin : current)
    }
    updateLayout()
    const observer = new ResizeObserver(updateLayout)
    observer.observe(page)
    const header = page.querySelector<HTMLElement>('.library-header')
    const overview = page.querySelector<HTMLElement>('.library-overview')
    const toolbar = page.querySelector<HTMLElement>('.library-files-head')
    if (header) observer.observe(header)
    if (overview) observer.observe(overview)
    if (toolbar) observer.observe(toolbar)
    return () => observer.disconnect()
  }, [displayEntries.length, toolbarStuck, view])

  useLayoutEffect(() => {
    rowVirtualizer.measure()
  }, [columnCount, gridWidth, rowVirtualizer, selectionMode, view, virtualRows])

  useLayoutEffect(() => {
    const mediaId = viewAnchorMediaIdRef.current
    if (mediaId == null) return
    const rowIndex = virtualRows.findIndex((row) => row.entries.some(({ entry }) => entry.type === 'item'
      ? entry.card.item.id === mediaId
      : entry.cards.some((card) => card.item.id === mediaId)))
    viewAnchorMediaIdRef.current = null
    if (rowIndex >= 0) rowVirtualizer.scrollToIndex(rowIndex, { align: 'center' })
  }, [rowVirtualizer, view, virtualRows])

  const currentMediaId = session.mediaId
  const currentMedia = currentMediaId == null ? null : library.find((item) => item.id === currentMediaId) ?? null
  const currentMediaKind: MediaKind | null = currentMedia && !currentMedia.isImage ? (currentMedia.isAudio ? 'audio' : 'video') : null
  const currentMediaRowIndex = useMemo(() => {
    if (currentMediaId == null) return -1
    return virtualRows.findIndex((row) => row.entries.some(({ entry }) => entry.type === 'item'
      ? entry.card.item.id === currentMediaId
      : entry.cards.some((card) => card.item.id === currentMediaId)))
  }, [currentMediaId, virtualRows])

  useEffect(() => {
    locatedMediaIdRef.current = null
    if (currentMediaId == null || currentMediaKind == null) return
    setQuery('')
    setKind(currentMediaKind)
  }, [currentMediaId, currentMediaKind])

  useEffect(() => {
    if (currentMediaId == null || locatedMediaIdRef.current === currentMediaId || kind !== currentMediaKind || query) return
    const collection = displayEntries.find((entry) => entry.type === 'collection' && entry.cards.some((card) => card.item.id === currentMediaId))
    if (collection?.type === 'collection' && !expandedCollections.has(collection.id)) {
      setExpandedCollections((current) => new Set(current).add(collection.id))
      return
    }
    let locateFrame = 0
    const frame = window.requestAnimationFrame(() => {
      if (currentMediaRowIndex >= 0) {
        rowVirtualizer.scrollToIndex(currentMediaRowIndex, { align: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
      }
      locateFrame = window.requestAnimationFrame(() => {
        const target = pageRef.current?.querySelector<HTMLElement>(`[data-media-id="${currentMediaId}"]`)
        if (!target) return
        target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center', inline: 'nearest' })
        locatedMediaIdRef.current = currentMediaId
      })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(locateFrame)
    }
  }, [currentMediaId, currentMediaKind, currentMediaRowIndex, displayEntries, expandedCollections, kind, query, reduceMotion, rowVirtualizer])

  const visibleMediaIds = useMemo(() => visibleCards.map((card) => card.item.id), [visibleCards])
  const allVisibleSelected = visibleMediaIds.length > 0 && visibleMediaIds.every((id) => selectedMediaIds.has(id))
  const hasAnimatedEntriesRef = useRef(false)
  const shouldStaggerEntries = displayEntries.length > 0 && !hasAnimatedEntriesRef.current

  useEffect(() => {
    if (displayEntries.length > 0) hasAnimatedEntriesRef.current = true
  }, [displayEntries.length])

  useEffect(() => {
    try { window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, view) } catch { void 0 }
  }, [view])

  useEffect(() => () => window.clearTimeout(viewAnimationTimerRef.current), [])

  const switchLibraryView = (nextView: ViewMode) => {
    if (nextView === view) return
    const page = pageRef.current
    const viewportCenter = (page?.scrollTop ?? 0) + (page?.clientHeight ?? 0) / 2
    const virtualItems = rowVirtualizer.getVirtualItems()
    let anchor = virtualItems[0] ?? null
    for (const item of virtualItems.slice(1)) {
      if (!anchor || Math.abs(item.start + item.size / 2 - viewportCenter) < Math.abs(anchor.start + anchor.size / 2 - viewportCenter)) anchor = item
    }
    const anchorEntry = anchor ? virtualRows[anchor.index]?.entries[0]?.entry : null
    viewAnchorMediaIdRef.current = anchorEntry?.type === 'item' ? anchorEntry.card.item.id : anchorEntry?.cards[0]?.item.id ?? null
    window.clearTimeout(viewAnimationTimerRef.current)
    setView(nextView)
    setViewHasChanged(true)
    viewAnimationTimerRef.current = window.setTimeout(() => {
      viewAnimationTimerRef.current = 0
      setViewHasChanged(false)
    }, 260)
  }

  const filesTitle = kind === 'video' ? t('videoFiles') : kind === 'audio' ? t('audioFiles') : t('favorites')

  const openCard = (card: LibraryCardData) => {
    if (selectionMode) {
      toggleSelected([card.item.id])
      return
    }
    if (card.item.sourceAvailable) {
      void play([card.item.id], 0)
      return
    }
    void addMediaDialog()
  }

  const toggleSelected = (ids: number[]) => {
    setSelectedMediaIds((current) => {
      const next = new Set(current)
      const allSelected = ids.every((id) => next.has(id))
      ids.forEach((id) => allSelected ? next.delete(id) : next.add(id))
      return next
    })
  }

  const leaveSelectionMode = () => {
    setSelectionMode(false)
    setSelectedMediaIds(new Set())
  }

  const toggleSelectAll = () => {
    setSelectedMediaIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) visibleMediaIds.forEach((id) => next.delete(id))
      else visibleMediaIds.forEach((id) => next.add(id))
      return next
    })
  }

  const createCollection = async () => {
    const ids = [...selectedMediaIds]
    if (ids.length < 2) return
    const first = library.find((item) => item.id === ids[0])
    const title = await prompt(t('createCollection'), first ? titleFor(first) : t('mediaCollection'), t('collectionNameHint'), t('create'))
    if (!title?.trim()) return
    setCollectionPreference((current) => ({
      ...current,
      manual: [...current.manual.filter((collection) => !collection.mediaIds.some((id) => ids.includes(id))), {
        id: `manual-${Date.now()}`,
        title: title.trim(),
        mediaIds: ids
      }]
    }))
    leaveSelectionMode()
  }

  const dissolveCollection = (collection: Extract<LibraryDisplayEntry, { type: 'collection' }>) => {
    setCollectionPreference((current) => collection.source === 'manual'
      ? { ...current, manual: current.manual.filter((item) => item.id !== collection.id) }
      : { ...current, excludedAutoIds: [...new Set([...current.excludedAutoIds, collection.id])] })
    setExpandedCollections((current) => { const next = new Set(current); next.delete(collection.id); return next })
  }

  const toggleCollection = (collectionId: string) => {
    setExpandedCollections((current) => {
      const next = new Set(current)
      if (next.has(collectionId)) next.delete(collectionId)
      else next.add(collectionId)
      return next
    })
  }

  const openCardMenu = (event: React.MouseEvent, card: LibraryCardData) => {
    event.preventDefault()
    event.stopPropagation()
    const item = card.item
    openCtxMenu(event.clientX, event.clientY, [
      { label: selectedMediaIds.has(item.id) ? t('deselectItem') : t('selectItem'), icon: 'check', checked: selectedMediaIds.has(item.id), onSelect: () => { setSelectionMode(true); toggleSelected([item.id]) } },
      { divider: true },
      { label: t('play'), icon: 'play', disabled: !item.sourceAvailable, onSelect: () => void play([item.id], 0) },
      { label: t('mediaInfo'), icon: 'info', onSelect: () => navigate({ section: 'library', mediaId: item.id }) },
      { label: t('addToQueue'), icon: 'playlist', disabled: !item.sourceAvailable, onSelect: () => void enqueue([item.id]) },
      { label: item.favorite ? t('unfavorite') : t('favorite'), icon: 'heart', checked: item.favorite, onSelect: () => toggleFavorite(item.id) },
      { divider: true },
      { label: t('regenerateCover'), icon: 'refresh', disabled: !item.sourceAvailable, onSelect: () => void p(I.probeRegenerateCover, item.id) },
      { label: t('revealFile'), icon: 'folder', disabled: item.protocol !== 'local' || !item.sourceAvailable, onSelect: () => void openPath(item.url) },
      { divider: true },
      {
        label: t('removeFromLibrary'),
        icon: 'trash',
        danger: true,
        onSelect: () => void confirm(t('removeMediaTitle'), t('removeMediaMessage'), { confirmLabel: t('remove'), danger: true }).then((accepted) => {
          if (accepted) void removeMedia([item.id])
        })
      }
    ])
  }

  const openCollectionMenu = (event: React.MouseEvent, collection: Extract<LibraryDisplayEntry, { type: 'collection' }>) => {
    event.preventDefault()
    event.stopPropagation()
    const playableIds = collection.cards.filter((card) => card.item.sourceAvailable).map((card) => card.item.id)
    const collectionIds = collection.cards.map((card) => card.item.id)
    openCtxMenu(event.clientX, event.clientY, [
      {
        label: t('playAll'),
        icon: 'play',
        disabled: playableIds.length === 0,
        onSelect: () => void play(playableIds, 0)
      },
      {
        label: t('addToQueue'),
        icon: 'playlist',
        disabled: playableIds.length === 0,
        onSelect: () => void enqueue(playableIds)
      },
      {
        label: expandedCollections.has(collection.id) ? t('collapseCollection') : t('expandCollection'),
        icon: expandedCollections.has(collection.id) ? 'chevronUp' : 'chevronDown',
        onSelect: () => toggleCollection(collection.id)
      },
      { divider: true },
      {
        label: t('dissolveCollection'),
        icon: 'close',
        onSelect: () => dissolveCollection(collection)
      },
      { divider: true },
      {
        label: t('removeFromLibrary'),
        icon: 'trash',
        danger: true,
        onSelect: () => void confirm(t('removeMediaTitle'), t('removeMediaMessage'), { confirmLabel: t('remove'), danger: true }).then((accepted) => {
          if (accepted) void removeMedia(collectionIds)
        })
      }
    ])
  }

  return (
    <main ref={pageRef} className="library-page" aria-labelledby="library-title">
      <header className="library-header">
        <div className="library-heading">
          <div className="library-eyebrow">{t('yourCollection')}</div>
          <h1 id="library-title">{t('libraryTitle')}</h1>
          <p>{t('libraryDescription')}</p>

        </div>

        <LibraryFilterControls
          kind={kind}
          query={query}
          favorites={libraryStats.favorites}
          videos={libraryStats.videos}
          audios={libraryStats.audios}
          locale={locale}
          mediaTypeLabel={t('mediaType')}
          favoritesLabel={t('favorites')}
          videosLabel={t('allVideos')}
          audiosLabel={t('allAudio')}
          searchLabel={t('search')}
          onKindChange={setKind}
          onQueryChange={setQuery}
        />
      </header>

      <section className="library-overview" aria-label={t('libraryOverview')}>
        {libraryStats.metrics.map((metric) => (
          <div className="library-metric" key={metric.label}>
            <div className="library-metric-icon"><Icon name={metric.icon} size={29} /></div>
            <div className="library-metric-copy">
              <span className="library-metric-label">{metric.label}</span>
              <div className="library-metric-value">
                {metric.duration !== undefined
                  ? <AggregateDuration seconds={metric.duration} hour={t('shortHour')} minute={t('shortMinute')} />
                  : <strong>{metric.value}</strong>}
                {metric.suffix && <span>{metric.suffix}</span>}
                {metric.detail && <em>{metric.detail}</em>}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="library-files" aria-labelledby="library-files-title">
        <div ref={toolbarSentinelRef} className="library-toolbar-sentinel" aria-hidden="true" />
        <div className={`library-files-head ${toolbarStuck ? 'is-stuck' : ''}`}>
          {toolbarStuck && (
            <LibraryFilterControls
              compact
              kind={kind}
              query={query}
              favorites={libraryStats.favorites}
              videos={libraryStats.videos}
              audios={libraryStats.audios}
              locale={locale}
              mediaTypeLabel={t('mediaType')}
              favoritesLabel={t('favorites')}
              videosLabel={t('allVideos')}
              audiosLabel={t('allAudio')}
              searchLabel={t('search')}
              onKindChange={setKind}
              onQueryChange={setQuery}
            />
          )}
          <h2 id="library-files-title">{filesTitle} <span>({visibleCards.length.toLocaleString(locale)})</span></h2>
          <div className="library-files-controls">
            <button
              type="button"
              className={`library-selection-toggle ${selectionMode ? 'active' : ''}`}
              onClick={() => selectionMode ? leaveSelectionMode() : setSelectionMode(true)}
            >
              <Icon name="check" size={17} /><span className="library-selection-label">{selectionMode ? t('cancelSelection') : t('selectItems')}</span>
            </button>
            <LibrarySortSelect
              value={sortBy}
              direction={sortDirection}
              options={[
                { value: 'added', label: t('sortAddedTime') },
                { value: 'name', label: t('sortName') },
                { value: 'size', label: t('sortFileSize') },
                { value: 'duration', label: t('sortDuration') }
              ]}
              label={t('sortBy')}
              ascendingLabel={t('sortAscending')}
              descendingLabel={t('sortDescending')}
              onChange={(nextSortBy) => setSortPreference((current) => ({ ...current, sortBy: nextSortBy }))}
              onDirectionChange={() => setSortPreference((current) => ({ ...current, sortDirection: current.sortDirection === 'asc' ? 'desc' : 'asc' }))}
            />
            <div className="library-view-toggle" role="group" aria-label={t('viewMode')}>
              <button
                type="button"
                className={view === 'grid' ? 'active' : ''}
                onClick={() => switchLibraryView('grid')}
                aria-label={t('gridView')}
                aria-pressed={view === 'grid'}
              >
                <Icon name="grid" size={21} />
              </button>
              <button
                type="button"
                className={view === 'list' ? 'active' : ''}
                onClick={() => switchLibraryView('list')}
                aria-label={t('listView')}
                aria-pressed={view === 'list'}
              >
                <Icon name="list" size={21} />
              </button>
            </div>
          </div>
        </div>

        {visibleCards.length > 0 ? (
          <div
            ref={gridRef}
            className={`library-file-grid ${view === 'list' ? 'list-view' : ''} ${selectionMode ? 'selection-mode' : ''} ${viewHasChanged ? `view-switch-${view}` : ''}`}
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              '--library-columns': columnCount,
              '--library-card-size': `${LIBRARY_GRID_CARD_WIDTH}px`
            } as React.CSSProperties}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = virtualRows[virtualRow.index]
              if (!row) return null
              return (
                <div
                  key={virtualRow.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  className={`library-virtual-row ${row.expanded ? 'collection-expanded' : ''}`}
                  style={{ transform: `translate3d(0, ${virtualRow.start - gridScrollMargin}px, 0)` }}
                >
                  {row.entries.map(({ entry, index }) => {
                    const expanded = entry.type === 'collection' && expandedCollections.has(entry.id)
                    const entryDelay = shouldStaggerEntries ? Math.min(index, 8) * 0.035 : 0
                    return (
                      <motion.div
                        key={displayEntryKey(entry)}
                        className={`library-entry-motion ${expanded ? 'collection-expanded' : ''}`}
                        style={{ '--library-entry-index': Math.min(index, 8) } as React.CSSProperties}
                        initial={reduceMotion || !shouldStaggerEntries ? false : { opacity: 0, y: 10, scale: 0.985, filter: 'brightness(0.62) saturate(0.72)' }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: 'brightness(1) saturate(1)' }}
                        transition={reduceMotion ? { duration: 0 } : {
                          opacity: { duration: 0.24, delay: entryDelay },
                          y: { duration: 0.44, delay: entryDelay, ease: [0.16, 1, 0.3, 1] },
                          scale: { duration: 0.4, delay: entryDelay, ease: [0.16, 1, 0.3, 1] },
                          filter: { duration: 0.5, delay: entryDelay, ease: [0.16, 1, 0.3, 1] }
                        }}
                      >
                        {entry.type === 'item' ? (
                          <LibraryFileCard card={entry.card} current={entry.card.item.id === currentMediaId} selected={selectedMediaIds.has(entry.card.item.id)} selectionMode={selectionMode} favoriteOnly={kind === 'favorite'} onToggleFavorite={() => void toggleFavorite(entry.card.item.id)} onOpen={() => openCard(entry.card)} onContextMenu={(event) => openCardMenu(event, entry.card)} />
                        ) : (
                          <LibraryCollectionCard
                            collection={entry}
                            expanded={expanded}
                            onToggle={() => toggleCollection(entry.id)}
                            selectionMode={selectionMode}
                            selected={entry.cards.every((card) => selectedMediaIds.has(card.item.id))}
                            selectedIds={selectedMediaIds}
                            currentMediaId={currentMediaId}
                            favoriteOnly={kind === 'favorite'}
                            onSelect={() => toggleSelected(entry.cards.map((card) => card.item.id))}
                            onToggleFavorite={(card) => void toggleFavorite(card.item.id)}
                            onOpen={openCard}
                            onContextMenu={openCardMenu}
                            onCollectionContextMenu={openCollectionMenu}
                            collectionLabel={t('mediaCollection')}
                            itemLabel={t('collectionItems')}
                            expandLabel={t('expandCollection')}
                            collapseLabel={t('collapseCollection')}
                          />
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="library-empty">
            <Icon name="search" size={27} />
            <div>
              <strong>{libraryStats.total > 0 ? t('noMatchingMedia') : t('libraryEmpty')}</strong>
              <span>{libraryStats.total > 0 ? t('tryAnotherSearch') : t('addMediaToStart')}</span>
            </div>
            <button
              type="button"
              onClick={() => {
                if (libraryStats.total > 0) {
                  setQuery('')
                  if (kind === 'favorite' || (kind === 'video' && libraryStats.videos === 0) || (kind === 'audio' && libraryStats.audios === 0)) {
                    setKind(libraryStats.videos > 0 ? 'video' : 'audio')
                  }
                } else {
                  void addMediaDialog()
                }
              }}
            >
              {libraryStats.total > 0 ? t('browseLibrary') : t('addMedia')}
            </button>
          </div>
        )}
        {selectionMode && (
          <div className="library-selection-bar">
            <span>{t('selectedCount', { count: selectedMediaIds.size })}</span>
            <button type="button" className="library-selection-all" disabled={visibleMediaIds.length === 0} onClick={toggleSelectAll}>
              <Icon name={allVisibleSelected ? 'close' : 'check'} size={16} />{allVisibleSelected ? t('deselectAll') : t('selectAll')}
            </button>
            <button type="button" disabled={selectedMediaIds.size < 2} onClick={() => void createCollection()}><Icon name="library" size={16} />{t('combineAsCollection')}</button>
            <button type="button" className="btn-icon" aria-label={t('cancelSelection')} onClick={leaveSelectionMode}><Icon name="close" size={16} /></button>
          </div>
        )}
      </section>
    </main>
  )
}

function LibraryCollectionCard({
  collection,
  expanded,
  onToggle,
  selectionMode,
  selected,
  selectedIds,
  currentMediaId,
  favoriteOnly,
  onSelect,
  onToggleFavorite,
  onOpen,
  onContextMenu,
  onCollectionContextMenu,
  collectionLabel,
  itemLabel,
  expandLabel,
  collapseLabel
}: {
  collection: Extract<LibraryDisplayEntry, { type: 'collection' }>
  expanded: boolean
  onToggle: () => void
  selectionMode: boolean
  selected: boolean
  selectedIds: Set<number>
  currentMediaId: number | null
  favoriteOnly: boolean
  onSelect: () => void
  onToggleFavorite: (card: LibraryCardData) => void
  onOpen: (card: LibraryCardData) => void
  onContextMenu: (event: React.MouseEvent, card: LibraryCardData) => void
  onCollectionContextMenu: (event: React.MouseEvent, collection: Extract<LibraryDisplayEntry, { type: 'collection' }>) => void
  collectionLabel: string
  itemLabel: string
  expandLabel: string
  collapseLabel: string
}) {
  const previewCards = collection.cards.slice(0, 3)
  return (
    <section className={`library-collection ${expanded ? 'expanded' : ''} ${selected ? 'selected' : ''} ${collection.cards.some((card) => card.item.id === currentMediaId) ? 'contains-current' : ''}`} data-collection-id={collection.id}>
      <button
        type="button"
        className="library-collection-summary"
        onClick={selectionMode ? onSelect : onToggle}
        onContextMenu={(event) => onCollectionContextMenu(event, collection)}
        aria-expanded={expanded}
        aria-label={`${expanded ? collapseLabel : expandLabel}: ${collection.title}`}
      >
        <span className="library-collection-art">
          {previewCards.map((card, index) => (
            <span className="library-collection-preview" key={card.item.id} style={{ '--preview-index': index } as React.CSSProperties}>
              {card.artwork ? <img src={card.artwork} alt="" /> : <span className="media-artwork-fallback compact"><Icon name="video" size={30} /></span>}
            </span>
          ))}
          <span className="library-card-glint" aria-hidden="true" />
          <span className="library-collection-badge"><Icon name="library" size={14} />{collectionLabel}</span>
          <span className="library-collection-count">{collection.cards.length}</span>
        </span>
        <span className="library-file-copy">
          <span className="library-file-title">{collection.title}</span>
          <span className="library-file-meta">
            <Icon name="video" size={14} />
            <span>{collection.cards.length} {itemLabel}</span>
            <Icon className="library-collection-chevron" name={expanded ? 'chevronUp' : 'chevronDown'} size={15} />
          </span>
        </span>
      </button>
      {expanded && (
        <div className="library-collection-items">
          {collection.cards.map((card) => (
            <LibraryFileCard key={card.item.id} card={card} current={card.item.id === currentMediaId} selected={selectedIds.has(card.item.id)} selectionMode={selectionMode} favoriteOnly={favoriteOnly} onToggleFavorite={() => onToggleFavorite(card)} onOpen={() => onOpen(card)} onContextMenu={(event) => onContextMenu(event, card)} />
          ))}
        </div>
      )}
    </section>
  )
}

function LibraryFileCard({ card, current, selected, selectionMode, favoriteOnly, onToggleFavorite, onOpen, onContextMenu }: {
  card: LibraryCardData
  current: boolean
  selected: boolean
  selectionMode: boolean
  favoriteOnly: boolean
  onToggleFavorite: () => void
  onOpen: () => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const { t } = useRuntime()
  const favoriteLabel = card.item.favorite ? t('unfavorite') : t('favorite')
  return (
    <div className={`library-file-card ${card.kind} ${selected ? 'selected' : ''} ${current ? 'is-current' : ''}`} data-media-id={card.item.id} onContextMenu={onContextMenu} title={card.title}>
      <button type="button" className="library-file-open" onClick={onOpen} aria-current={current ? 'true' : undefined} aria-pressed={selectionMode ? selected : undefined}>
        <span className={`library-file-art ${card.kind === 'audio' ? 'audio-art' : ''}`}>
          {card.kind === 'audio' ? (
            <AudioArtwork artwork={card.artwork} />
          ) : card.artwork ? (
            <img src={card.artwork} alt="" />
          ) : (
            <span className="media-artwork-fallback compact"><Icon name="video" size={31} /></span>
          )}
          <span className="library-card-glint" aria-hidden="true" />
          {card.overlayDuration && <span className="library-file-duration">{card.overlayDuration}</span>}
          {selectionMode && <span className="library-card-selection"><Icon name="check" size={14} /></span>}
        </span>
        <span className="library-file-copy">
          <span className="library-file-title">{card.title}</span>
          <span className="library-file-meta">
            <Icon name={card.kind === 'video' ? 'file' : 'music'} size={14} />
            <span>{card.metadata}</span>
          </span>
        </span>
      </button>
      {!selectionMode && (
        <button
          type="button"
          className={`library-card-favorite ${card.item.favorite ? 'is-favorite' : ''} ${favoriteOnly ? 'remove-only' : ''}`}
          aria-label={favoriteOnly ? t('unfavorite') : favoriteLabel}
          title={favoriteOnly ? t('unfavorite') : favoriteLabel}
          aria-pressed={card.item.favorite}
          onClick={(event) => {
            event.stopPropagation()
            onToggleFavorite()
          }}
        >
          <span className="library-card-favorite-glyph" key={card.item.favorite ? 'filled' : 'outline'}>
            {card.item.favorite ? <FilledIcon name="heartFilled" size={17} /> : <Icon name="heart" size={17} />}
          </span>
        </button>
      )}
    </div>
  )
}
