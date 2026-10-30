import React, { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useId } from 'react'
import { LayoutGroup, useReducedMotion } from 'motion/react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { p, useLibraryRuntime } from '../core/runtime'
import { FilledIcon, Icon, type IconName } from '../core/icons'
import { coverUrl } from '../core/player'
import { displayMediaTitle, formatBytes, type MediaItem } from '../../shared/types'
import { I } from '../../shared/channels'
import { collectSimilarVideos } from './libraryCollections'
import { AudioArtwork } from './mediaArtwork'
import { FloatingMenu } from '../shared/floatingMenu'
import { clearIdleThumbnails, ThumbnailImage } from '../shared/thumbnail'
import { TabHighlight, useItemRevealAnimation } from '../shared/tabMotion'

type MediaKind = 'video' | 'audio'
type LibraryTab = 'all' | 'favorite' | MediaKind
type SourceFilter = 'all' | 'local' | 'remote' | 'unavailable'
type ViewMode = 'grid' | 'list'
type SortBy = 'added' | 'played' | 'name' | 'size' | 'duration'
type SortDirection = 'asc' | 'desc'

type LibrarySortPreference = { sortBy: SortBy; sortDirection: SortDirection }
type ManualCollection = { id: string; title: string; mediaIds: number[] }
type LibraryCollectionPreference = { manual: ManualCollection[]; excludedAutoIds: string[] }

const LIBRARY_SORT_STORAGE_KEY = 'aurora.library.sort.v1'
const LIBRARY_COLLECTION_STORAGE_KEY = 'aurora.library.collections.v1'
const LIBRARY_VIEW_STORAGE_KEY = 'aurora.library.view.v1'
const LIBRARY_GRID_CARD_WIDTH = 220
const LIBRARY_GRID_COLUMN_GAP = 17
const LIBRARY_GRID_SELECTION_GAP = 17
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
    const sortBy = parsed.sortBy === 'added' || parsed.sortBy === 'played' || parsed.sortBy === 'name' || parsed.sortBy === 'size' || parsed.sortBy === 'duration'
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
  const manual = current.manual
    .map((collection) => ({ ...collection, mediaIds: collection.mediaIds.filter((id) => availableMediaIds.has(id)) }))
    .filter((collection) => collection.mediaIds.length >= 2)
  const excludedAutoIds = current.excludedAutoIds.length === 0
    ? current.excludedAutoIds
    : (() => {
        const availableAutoCollectionIds = new Set(collectSimilarVideos(
          items.filter((item) => !item.isAudio && !item.isImage)
        ).map((collection) => collection.id))
        return current.excludedAutoIds.filter((id) => availableAutoCollectionIds.has(id))
      })()
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

type LibraryDisplayEntry =
  | { type: 'item'; card: LibraryCardData }
  | { type: 'collection'; id: string; title: string; cards: LibraryCardData[]; source: 'auto' | 'manual' }

type LibraryVirtualEntry = { entry: LibraryDisplayEntry; index: number }
type LibraryVirtualRow = {
  key: string
  entries: LibraryVirtualEntry[]
  expanded: boolean
  collectionChild?: boolean
  firstCollectionRow?: boolean
}

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
      // Children participate in the same virtual window as ordinary cards.
      // A large collection must never mount all of its covers in one row.
      for (let offset = 0; offset < entry.cards.length; offset += columns) {
        const children: LibraryVirtualEntry[] = entry.cards.slice(offset, offset + columns)
          .map((card): LibraryVirtualEntry => ({ entry: { type: 'item', card }, index }))
        rows.push({
          key: `children-${entry.id}-${children.map(({ entry }) => displayEntryKey(entry)).join('|')}`,
          entries: children,
          expanded: false,
          collectionChild: true,
          firstCollectionRow: offset === 0
        })
      }
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

function metadataFor(item: MediaItem, unknownArtist: string, video: string, hour: string, minute: string): string {
  if (item.isAudio) {
    const artist = item.artist || unknownArtist
    return item.album ? `${artist} · ${item.album}` : artist
  }
  const duration = formatCompactDuration(item.duration, hour, minute)
  return duration ? `${duration} · ${video}` : video
}

type LibraryToolbarOption = {
  label: string
  icon: IconName
  onSelect: () => void
  checked?: boolean
  role?: 'menuitemradio' | 'menuitemcheckbox'
  disabled?: boolean
  hint?: string
  divider?: boolean
}

function LibraryToolbarMenu({ label, icon, active = false, options }: {
  label: string
  icon: IconName
  active?: boolean
  options: LibraryToolbarOption[]
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const menuId = useId()
  const close = () => { setOpen(false); triggerRef.current?.focus() }
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => optionRefs.current.find((node) => node && !node.disabled)?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])
  const moveFocus = (index: number, offset: number) => {
    for (let step = 1; step <= options.length; step++) {
      const next = (index + offset * step + options.length) % options.length
      if (!options[next].disabled) { optionRefs.current[next]?.focus(); break }
    }
  }
  return (
    <>
      <button ref={triggerRef} type="button" className={`library-action icon ${active ? 'active' : ''}`}
        aria-label={label} data-tooltip={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(!open)} onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true) }
        }}><Icon name={icon} size={17} /></button>
      <FloatingMenu open={open} anchorRef={triggerRef} onClose={() => setOpen(false)} className="library-source-menu library-popover library-toolbar-menu" width={220} gap={7} align="end">
        <div id={menuId} role="menu" aria-label={label}>
          {options.map((option, index) => (
            <React.Fragment key={option.label}>
              {option.divider && <div className="library-menu-divider" role="separator" />}
              <button ref={(node) => { optionRefs.current[index] = node }} type="button" role={option.role ?? 'menuitem'}
                aria-checked={option.role ? !!option.checked : undefined} disabled={option.disabled} data-tooltip={option.hint} aria-label={option.hint}
                className={option.checked ? 'selected' : ''} tabIndex={-1}
                onClick={() => { close(); option.onSelect() }} onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault(); moveFocus(index, event.key === 'ArrowDown' ? 1 : -1)
                  } else if (event.key === 'Home' || event.key === 'End') {
                    event.preventDefault(); moveFocus(event.key === 'Home' ? options.length - 1 : 0, event.key === 'Home' ? 1 : -1)
                  } else if (event.key === 'Escape') {
                    event.preventDefault(); event.stopPropagation(); close()
                  } else if (event.key === 'Tab') close()
                }}>
                <Icon name={option.icon} size={16} /><span>{option.label}</span>{option.checked && <Icon name="check" size={15} />}
              </button>
            </React.Fragment>
          ))}
        </div>
      </FloatingMenu>
    </>
  )
}

function readBrowsePreference(): { kind: LibraryTab; query: string; source: SourceFilter; grouped: boolean } {
  try {
    const value = JSON.parse(window.sessionStorage.getItem('aurora.library.browse.v1') || '{}')
    const storedKind = ['all', 'video', 'audio', 'favorite'].includes(value.kind) ? value.kind as LibraryTab : 'video'
    return {
      // “All files” remains an internal filter for locating the current item, but is no longer a visible tab.
      kind: storedKind === 'all' ? 'video' : storedKind,
      query: typeof value.query === 'string' ? value.query : '',
      source: ['all', 'local', 'remote', 'unavailable'].includes(value.source) ? value.source : 'all',
      grouped: value.grouped === true
    }
  } catch { return { kind: 'video', query: '', source: 'all', grouped: false } }
}

function LibraryPageView() {
  const { t, settings, library, currentMediaId, play, addMediaDialog, enqueue, toggleFavorite, setFavorites, removeMedia, confirm, prompt, openPath, openCtxMenu, navigate, addFolderDialog, toast } = useLibraryRuntime()
  const locale = settings?.language === 'zh' ? 'zh-CN' : 'en-US'
  const [availabilityRefreshing, setAvailabilityRefreshing] = useState(false)
  const refreshAvailability = useCallback(async (includeRemote = true) => {
    setAvailabilityRefreshing(true)
    try { await p(I.libraryRefreshAvailability, includeRemote) }
    catch { toast('error', settings.language === 'zh' ? '无法检查文件状态，请重试' : 'Unable to check file availability') }
    finally { setAvailabilityRefreshing(false) }
  }, [settings.language, toast])
  const systemReducedMotion = useReducedMotion()
  const reduceMotion = settings.reducedMotion || systemReducedMotion
  const [initialBrowse] = useState(readBrowsePreference)
  const [initialScroll] = useState(() => {
    try { return Math.max(0, Number(window.sessionStorage.getItem('aurora.library.scroll.v1')) || 0) } catch { return 0 }
  })
  const [query, setQuery] = useState(initialBrowse.query)
  const [searchOpen, setSearchOpen] = useState(initialBrowse.query !== '')
  const [kind, setKind] = useState<LibraryTab>(initialBrowse.kind)
  const [source, setSource] = useState<SourceFilter>(initialBrowse.source)
  const [grouped, setGrouped] = useState(initialBrowse.grouped)
  const filterSignature = JSON.stringify([kind, query, source])
  const previousFiltersRef = useRef(filterSignature)
  const [busy, setBusy] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchToggleRef = useRef<HTMLButtonElement>(null)
  const searchWasOpenRef = useRef(false)
  const openSearch = useCallback(() => {
    if (searchRef.current) { searchRef.current.focus(); searchRef.current.select(); return }
    setSearchOpen(true)
  }, [])
  const closeSearch = useCallback(() => {
    setQuery('')
    setSearchOpen(false)
  }, [])
  useEffect(() => {
    if (searchOpen) { searchRef.current?.focus(); searchRef.current?.select() }
    else if (searchWasOpenRef.current) searchToggleRef.current?.focus()
    searchWasOpenRef.current = searchOpen
  }, [searchOpen])
  const selectionAnchorRef = useRef<number | null>(null)
  const [view, setView] = useState<ViewMode>(readLibraryViewMode)
  const [sortPreference, setSortPreference] = useState<LibrarySortPreference>(readLibrarySortPreference)
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(() => new Set())
  const [collectionPreference, setCollectionPreference] = useState<LibraryCollectionPreference>(readLibraryCollectionPreference)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedMediaIds, setSelectedMediaIds] = useState<Set<number>>(() => new Set())
  const pageRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const scrollHideTimerRef = useRef(0)
  const revealScrollbar = useCallback(() => {
    scrollRef.current?.classList.add('is-scrolling')
    window.clearTimeout(scrollHideTimerRef.current)
    scrollHideTimerRef.current = window.setTimeout(() => scrollRef.current?.classList.remove('is-scrolling'), 2000)
  }, [])
  useEffect(() => () => window.clearTimeout(scrollHideTimerRef.current), [])
  const gridRef = useRef<HTMLDivElement>(null)
  const viewAnchorMediaIdRef = useRef<number | null>(null)
  const locatedMediaIdRef = useRef<number | null>(null)
  const [gridWidth, setGridWidth] = useState(0)
  const [gridScrollMargin, setGridScrollMargin] = useState(0)
  const { sortBy, sortDirection } = sortPreference

  useEffect(() => {
    try { window.sessionStorage.setItem('aurora.library.browse.v1', JSON.stringify({ kind, query, source, grouped })) } catch { /* optional preferences */ }
  }, [kind, query, source, grouped])

  useEffect(() => {
    setSelectedMediaIds(new Set())
    selectionAnchorRef.current = null
    if (previousFiltersRef.current !== filterSignature) scrollRef.current?.scrollTo({ top: 0 })
    previousFiltersRef.current = filterSignature
  }, [filterSignature])

  useEffect(() => {
    const page = scrollRef.current
    if (!page) return
    let saveTimer = 0
    const persistScroll = () => {
      try { window.sessionStorage.setItem('aurora.library.scroll.v1', String(page.scrollTop)) } catch { /* optional preferences */ }
    }
    const saveScroll = () => {
      window.clearTimeout(saveTimer)
      saveTimer = window.setTimeout(persistScroll, 300)
    }
    const focusSearch = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); openSearch()
      }
    }
    page.addEventListener('scroll', saveScroll, { passive: true })
    window.addEventListener('keydown', focusSearch)
    return () => {
      window.clearTimeout(saveTimer)
      persistScroll()
      page.removeEventListener('scroll', saveScroll)
      window.removeEventListener('keydown', focusSearch)
    }
  }, [openSearch])

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
    setSelectedMediaIds((current) => {
      const next = new Set([...current].filter((id) => available.has(id)))
      return next.size === current.size ? current : next
    })
    setCollectionPreference((current) => pruneCollectionPreference(current, library))
  }, [library])

  const { cards, libraryStats } = useMemo(() => {
    const cards: LibraryCardData[] = []
    const stats = { total: 0, favorites: 0, videos: 0, audios: 0, totalDuration: 0 }
    const unknownArtist = t('unknownArtist')
    const videoLabel = t('video')
    const hourLabel = t('shortHour')
    const minuteLabel = t('shortMinute')
    for (const item of library) {
      if (item.isImage) continue
      const kind: MediaKind = item.isAudio ? 'audio' : 'video'
      stats.total++
      stats.favorites += item.favorite ? 1 : 0
      stats.audios += item.isAudio ? 1 : 0
      stats.videos += item.isAudio ? 0 : 1
      stats.totalDuration += Math.max(0, item.duration || 0)
      cards.push({
        kind,
        item,
        title: displayMediaTitle(item.title, item.fileName),
        artwork: item.coverPath ? coverUrl(item.coverPath) : null,
        overlayDuration: formatOverlayDuration(item.duration),
        metadata: metadataFor(item, unknownArtist, videoLabel, hourLabel, minuteLabel)
      })
    }
    return { cards, libraryStats: stats }
  }, [library, t])

  const deferredQuery = useDeferredValue(query)
  useItemRevealAnimation(JSON.stringify([kind, source, deferredQuery, grouped, view, sortBy, sortDirection]), !!reduceMotion, gridRef)
  const collator = useMemo(() => new Intl.Collator(locale, { numeric: true, sensitivity: 'base' }), [locale])

  const visibleCards = useMemo(() => {
    const terms = deferredQuery.trim().toLocaleLowerCase(locale).split(/\s+/).filter(Boolean)
    const filtered = cards.filter((card) => {
      if (kind !== 'all' && (kind === 'favorite' ? !card.item.favorite : card.kind !== kind)) return false
      if (source === 'local' && card.item.protocol !== 'local') return false
      if (source === 'remote' && card.item.protocol === 'local') return false
      if (source === 'unavailable' && card.item.sourceAvailable) return false
      if (!terms.length) return true
      const itemText = `${card.item.fileName} ${card.item.artist} ${card.item.album} ${card.item.sourceName}`
      const haystack = `${card.title} ${card.metadata} ${itemText}`.toLocaleLowerCase(locale)
      return terms.every((term) => haystack.includes(term))
    })
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
      else if (sortBy === 'played') comparison = left.item.lastPlayedAt - right.item.lastPlayedAt
      else comparison = left.item.addedAt - right.item.addedAt
      if (comparison === 0) comparison = left.item.id - right.item.id
      return comparison * direction
    })
  }, [cards, kind, source, locale, deferredQuery, sortBy, sortDirection, collator])

  const displayEntries = useMemo<LibraryDisplayEntry[]>(() => {
    if (!grouped || deferredQuery.trim()) return visibleCards.map((card) => ({ type: 'item', card }))
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
  }, [collectionPreference, visibleCards, grouped, deferredQuery])

  const gridColumnGap = selectionMode ? LIBRARY_GRID_SELECTION_GAP : LIBRARY_GRID_COLUMN_GAP
  const measuredGridWidth = gridWidth > 0
    ? gridWidth
    : LIBRARY_GRID_CARD_WIDTH * DEFAULT_LIBRARY_GRID_COLUMNS + gridColumnGap * (DEFAULT_LIBRARY_GRID_COLUMNS - 1)
  const columnCount = view === 'list'
    ? 1
    : Math.min(DEFAULT_LIBRARY_GRID_COLUMNS, Math.max(1, Math.floor((measuredGridWidth + gridColumnGap) / (LIBRARY_GRID_CARD_WIDTH + gridColumnGap))))
  const virtualRows = useMemo(
    () => buildVirtualRows(displayEntries, columnCount, expandedCollections),
    [columnCount, displayEntries, expandedCollections]
  )
  const estimateRowSize = useCallback((index: number) => {
    const row = virtualRows[index]
    if (row?.expanded) return view === 'list' ? 104 : 78
    const inset = row?.firstCollectionRow ? (view === 'list' ? 6 : 18) : 0
    if (view === 'list') {
      return 80 + inset + (row?.collectionChild ? 2 : 0)
    }
    const rowGap = 0
    const cardHeight = ((measuredGridWidth - gridColumnGap * (columnCount - 1)) / columnCount) * (9 / 16) + 100
    return cardHeight + rowGap + inset
  }, [columnCount, gridWidth, measuredGridWidth, gridColumnGap, selectionMode, view, virtualRows])
  const getVirtualRowKey = useCallback((index: number) => virtualRows[index]?.key ?? index, [virtualRows])
  const rowVirtualizer = useVirtualizer<HTMLElement, HTMLDivElement>({
    count: virtualRows.length,
    initialOffset: initialScroll,
    // React 19 warns when TanStack's synchronous range update runs from a
    // ref/layout-effect commit. A normal scheduled render is sufficient here
    // because row positions are already calculated from the virtualizer state.
    useFlushSync: false,
    getScrollElement: () => scrollRef.current,
    estimateSize: estimateRowSize,
    getItemKey: getVirtualRowKey,
    overscan: view === 'list' ? 8 : 3,
    scrollMargin: gridScrollMargin
  })

  // React detaches callback refs before removing their DOM nodes. Sweep after
  // the commit, when isConnected is false, so measurements cannot retain cards
  // (and their decoded covers) that have left the virtual window.
  useLayoutEffect(() => { rowVirtualizer.measureElement(null) })
  useLayoutEffect(() => {
    // The virtualizer keeps measured sizes by key across filters and layouts.
    // Retain only keys in this data set, rather than every historical grouping.
    const keys = new Set(virtualRows.map((row) => row.key))
    for (const key of rowVirtualizer.itemSizeCache.keys()) {
      if (typeof key !== 'string' || !keys.has(key)) rowVirtualizer.itemSizeCache.delete(key)
    }
  }, [rowVirtualizer, virtualRows])
  useEffect(() => () => { queueMicrotask(clearIdleThumbnails) }, [filterSignature, grouped, view])

  useLayoutEffect(() => {
    const page = scrollRef.current
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
    observer.observe(grid)
    return () => observer.disconnect()
  }, [displayEntries.length, selectionMode, view])

  useLayoutEffect(() => {
    const mediaId = viewAnchorMediaIdRef.current
    if (mediaId == null) return
    const rowIndex = virtualRows.findIndex((row) => row.entries.some(({ entry }) => entry.type === 'item'
      ? entry.card.item.id === mediaId
      : !row.expanded && entry.cards.some((card) => card.item.id === mediaId)))
    viewAnchorMediaIdRef.current = null
    if (rowIndex >= 0) rowVirtualizer.scrollToIndex(rowIndex, { align: 'center' })
  }, [rowVirtualizer, view, virtualRows])

  const currentMedia = currentMediaId == null ? null : library.find((item) => item.id === currentMediaId) ?? null
  const currentMediaKind: MediaKind | null = currentMedia && !currentMedia.isImage ? (currentMedia.isAudio ? 'audio' : 'video') : null
  const currentMediaRowIndex = useMemo(() => {
    if (currentMediaId == null) return -1
    return virtualRows.findIndex((row) => row.entries.some(({ entry }) => entry.type === 'item'
      ? entry.card.item.id === currentMediaId
      : !row.expanded && entry.cards.some((card) => card.item.id === currentMediaId)))
  }, [currentMediaId, virtualRows])

  const [locateRequested, setLocateRequested] = useState(false)
  const locateCurrent = () => {
    locatedMediaIdRef.current = null
    setQuery('')
    setSource('all')
    setKind(currentMediaKind ?? 'video')
    setLocateRequested(true)
  }

  useEffect(() => {
    if (!locateRequested || currentMediaId == null || locatedMediaIdRef.current === currentMediaId || source !== 'all' || query) return
    const collection = displayEntries.find((entry) => entry.type === 'collection' && entry.cards.some((card) => card.item.id === currentMediaId))
    if (collection?.type === 'collection' && !expandedCollections.has(collection.id)) {
      setExpandedCollections((current) => new Set(current).add(collection.id))
      return
    }
    let locateFrame = 0
    const frame = window.requestAnimationFrame(() => {
      if (currentMediaRowIndex >= 0) {
        rowVirtualizer.scrollToIndex(currentMediaRowIndex, { align: 'center' })
      }
      locateFrame = window.requestAnimationFrame(() => {
        const target = pageRef.current?.querySelector<HTMLElement>(`[data-media-id="${currentMediaId}"]`)
        if (!target) return
        scrollRef.current?.scrollBy({ top: target.getBoundingClientRect().top - scrollRef.current.getBoundingClientRect().top - (scrollRef.current.clientHeight - target.clientHeight) / 2, behavior: reduceMotion ? 'auto' : 'smooth' })
        locatedMediaIdRef.current = currentMediaId
        setLocateRequested(false)
      })
    })
    return () => {
      window.cancelAnimationFrame(frame)
      window.cancelAnimationFrame(locateFrame)
    }
  }, [locateRequested, currentMediaId, currentMediaKind, currentMediaRowIndex, displayEntries, expandedCollections, kind, source, query, reduceMotion, rowVirtualizer])

  const visibleMediaIds = useMemo(() => visibleCards.map((card) => card.item.id), [visibleCards])
  const allVisibleSelected = visibleMediaIds.length > 0 && visibleMediaIds.every((id) => selectedMediaIds.has(id))
  useEffect(() => {
    try { window.localStorage.setItem(LIBRARY_VIEW_STORAGE_KEY, view) } catch { void 0 }
  }, [view])


  const switchLibraryView = (nextView: ViewMode) => {
    if (nextView === view) return
    const page = scrollRef.current
    const viewportCenter = (page?.scrollTop ?? 0) + (page?.clientHeight ?? 0) / 2
    const virtualItems = rowVirtualizer.getVirtualItems()
    let anchor = virtualItems[0] ?? null
    for (const item of virtualItems.slice(1)) {
      if (!anchor || Math.abs(item.start + item.size / 2 - viewportCenter) < Math.abs(anchor.start + anchor.size / 2 - viewportCenter)) anchor = item
    }
    const anchorEntry = anchor ? virtualRows[anchor.index]?.entries[0]?.entry : null
    viewAnchorMediaIdRef.current = anchorEntry?.type === 'item' ? anchorEntry.card.item.id : anchorEntry?.cards[0]?.item.id ?? null
    setView(nextView)
  }

  const filesTitle = kind === 'video' ? t('videoFiles') : kind === 'audio' ? t('audioFiles') : kind === 'favorite' ? t('favorites') : t('allFiles')
  const checkFilesLabel = settings.language === 'zh' ? (availabilityRefreshing ? '检查中…' : '检查文件') : (availabilityRefreshing ? 'Checking…' : 'Check files')

  const openCard = (card: LibraryCardData, event?: React.MouseEvent) => {
    if (selectionMode || event?.ctrlKey || event?.metaKey || event?.shiftKey) {
      setSelectionMode(true)
      const anchor = selectionAnchorRef.current
      if (event?.shiftKey && anchor != null) {
        const from = visibleMediaIds.indexOf(anchor)
        const to = visibleMediaIds.indexOf(card.item.id)
        if (from >= 0 && to >= 0) {
          const range = visibleMediaIds.slice(Math.min(from, to), Math.max(from, to) + 1)
          setSelectedMediaIds((current) => new Set([...current, ...range]))
          return
        }
      }
      selectionAnchorRef.current = card.item.id
      toggleSelected([card.item.id])
      return
    }
    if (card.item.sourceAvailable) {
      const ids = visibleCards.filter((candidate) => candidate.item.sourceAvailable).map((candidate) => candidate.item.id)
      void play(ids, ids.indexOf(card.item.id))
      return
    }
    navigate({ section: 'library', mediaId: card.item.id })
    toast('info', t('libraryUnavailableHint'))
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
    selectionAnchorRef.current = null
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
    const ids = visibleCards.filter((card) => selectedMediaIds.has(card.item.id)).map((card) => card.item.id)
    if (ids.length < 2) return
    const first = library.find((item) => item.id === ids[0])
    const title = await prompt(t('createCollection'), first ? displayMediaTitle(first.title, first.fileName) : t('mediaCollection'), t('collectionNameHint'), t('create'))
    if (!title?.trim()) return
    setCollectionPreference((current) => ({
      ...current,
      manual: [...current.manual.map((collection) => ({ ...collection, mediaIds: collection.mediaIds.filter((id) => !ids.includes(id)) })).filter((collection) => collection.mediaIds.length >= 2), {
        id: `manual-${Date.now()}`,
        title: title.trim(),
        mediaIds: ids
      }]
    }))
    setGrouped(true)
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
    const anchor = event.type === 'click' ? event.currentTarget.getBoundingClientRect() : null
    openCtxMenu(anchor?.left ?? event.clientX, anchor?.bottom ?? event.clientY, [
      { label: selectedMediaIds.has(item.id) ? t('deselectItem') : t('selectItem'), icon: 'check', checked: selectedMediaIds.has(item.id), onSelect: () => { setSelectionMode(true); toggleSelected([item.id]) } },
      { divider: true },
      { label: t('play'), icon: 'play', disabled: !item.sourceAvailable, onSelect: () => void play([item.id], 0) },
      { label: t('mediaInfo'), icon: 'info', onSelect: () => navigate({ section: 'library', mediaId: item.id }) },
      { label: t('addToQueue'), icon: 'playlist', disabled: !item.sourceAvailable, onSelect: () => void enqueue([item.id]) },
      { label: item.favorite ? t('unfavorite') : t('favorite'), icon: 'heart', checked: item.favorite, onSelect: () => toggleFavorite(item.id) },
      { divider: true },
      ...(!item.isAudio ? [{ label: t('regenerateCover'), icon: 'refresh' as const, disabled: !item.sourceAvailable, onSelect: () => void p(I.probeRegenerateCover, item.id) }] : []),
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
    const anchor = event.type === 'click' ? event.currentTarget.getBoundingClientRect() : null
    openCtxMenu(anchor?.left ?? event.clientX, anchor?.bottom ?? event.clientY, [
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

  const selectedCards = useMemo(() => visibleCards.filter((card) => selectedMediaIds.has(card.item.id)), [selectedMediaIds, visibleCards])
  const allSelectedFavorite = selectedCards.length > 0 && selectedCards.every((card) => card.item.favorite)
  const resetFilters = () => { setKind('video'); setQuery(''); setSource('all') }
  const removeSelected = async () => {
    const ids = selectedCards.map((card) => card.item.id)
    if (!ids.length || busy) return
    const accepted = await confirm(t('removeMediaTitle'), `${t('libraryRemoveCount', { count: ids.length })} ${t('removeMediaMessage')}`, { confirmLabel: t('remove'), danger: true })
    if (!accepted) return
    setBusy(true)
    try { await removeMedia(ids); leaveSelectionMode() }
    catch { toast('error', t('libraryActionFailed')) }
    finally { setBusy(false) }
  }
  const handleKeys = (event: React.KeyboardEvent) => {
    if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"], [role="listbox"]')) return
    const editing = event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation(); openSearch()
    } else if (event.key === 'Escape') {
      if (editing) { event.preventDefault(); closeSearch() }
      else if (selectionMode) { event.preventDefault(); leaveSelectionMode() }
    } else if (!editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation(); setSelectionMode(true); setSelectedMediaIds(new Set(visibleMediaIds))
    }
  }

  return (
    <main ref={pageRef} className={`library-page library-workspace ${reduceMotion ? 'is-reduced' : ''}`} aria-label={t('libraryTitle')} onKeyDown={handleKeys} tabIndex={-1}>
      <section className="library-files" aria-label={filesTitle}>
        <div className="library-files-head library-toolbar">
          <div className="library-organize-row">
            <LayoutGroup id="library-tab-selection"><div className="library-tab-dock has-tab-motion" role="group" aria-label={t('mediaType')}>
              {([
                ['video', t('videos'), 'video', libraryStats.videos],
                ['audio', t('audios'), 'music', libraryStats.audios],
                ['favorite', t('favorites'), 'heart', libraryStats.favorites]
              ] as const).map(([value, label, icon, count]) => (
                <button type="button" key={value} aria-pressed={kind === value} aria-label={`${label} ${count.toLocaleString(locale)}`} data-tooltip={label} className={kind === value ? 'active' : ''} onClick={() => setKind(value)}>
                  {kind === value && <TabHighlight reducedMotion={!!reduceMotion} />}
                  <Icon name={icon} size={16} />
                  <span className="library-category-label">{label}</span>
                  <span className="library-category-count">{count.toLocaleString(locale)}</span>
                </button>
              ))}
            </div></LayoutGroup>
            <div className="library-toolbar-spacer" />
            {!selectionMode && (query || source !== 'all'
              ? <span className="library-toolbar-hint is-results" aria-live="polite">{t('libraryResults', { count: visibleCards.length.toLocaleString(locale) })}</span>
              : <button type="button" className="library-toolbar-info" data-tooltip={t('libraryBrowseHint')} aria-label={t('libraryBrowseHint')}><Icon name="info" size={16} /></button>)}
            <div className="library-toolbar-actions" role="group" aria-label={t('libraryActions')}>
              <button ref={searchToggleRef} type="button" className="library-action icon" onClick={openSearch} aria-label={t('search')} data-tooltip={t('search')} aria-expanded={searchOpen}><Icon name="search" size={17} /></button>
              <LibraryToolbarMenu label={t('addMedia')} icon="plus" options={[
                { label: t('addFile'), icon: 'file', onSelect: () => void addMediaDialog() },
                { label: t('libraryAddFolder'), icon: 'folder', onSelect: () => void addFolderDialog() }
              ]} />
              <span className="library-toolbar-actions-divider" aria-hidden="true" />
              <LibraryToolbarMenu label={`${t('librarySourceFilter')}: ${t(source === 'all' ? 'libraryAllSources' : source === 'local' ? 'libraryLocal' : source === 'remote' ? 'libraryRemote' : 'libraryUnavailable')}`} icon="filter" active={source !== 'all'} options={[
                { value: 'all', label: t('libraryAllSources'), icon: 'library' },
                { value: 'local', label: t('libraryLocal'), icon: 'folder' },
                { value: 'remote', label: t('libraryRemote'), icon: 'network' },
                { value: 'unavailable', label: t('libraryUnavailable'), icon: 'alert' }
              ].map((option) => ({ label: option.label, icon: option.icon as IconName, role: 'menuitemradio', checked: source === option.value, onSelect: () => setSource(option.value as SourceFilter) }))} />
              <LibraryToolbarMenu label={`${t('sortBy')}: ${t(sortBy === 'added' ? 'sortAddedTime' : sortBy === 'played' ? 'librarySortPlayed' : sortBy === 'name' ? 'sortName' : sortBy === 'size' ? 'sortFileSize' : 'sortDuration')}, ${t(sortDirection === 'asc' ? 'sortAscending' : 'sortDescending')}`} icon="sort" options={[
                ...([
                  { value: 'added', label: t('sortAddedTime'), icon: 'calendar' },
                  { value: 'played', label: t('librarySortPlayed'), icon: 'history' },
                  { value: 'name', label: t('sortName'), icon: 'text' },
                  { value: 'size', label: t('sortFileSize'), icon: 'hardDrive' },
                  { value: 'duration', label: t('sortDuration'), icon: 'clock' }
                ] as const).map((option) => ({
                  label: option.label, icon: option.icon, role: 'menuitemradio' as const, checked: sortBy === option.value,
                  onSelect: () => { setSortPreference({ sortBy: option.value, sortDirection: option.value === 'name' ? 'asc' : 'desc' }); scrollRef.current?.scrollTo({ top: 0 }) }
                })),
                { label: t('sortAscending'), icon: 'up', role: 'menuitemradio', checked: sortDirection === 'asc', divider: true, onSelect: () => setSortPreference((current) => ({ ...current, sortDirection: 'asc' })) },
                { label: t('sortDescending'), icon: 'down', role: 'menuitemradio', checked: sortDirection === 'desc', onSelect: () => setSortPreference((current) => ({ ...current, sortDirection: 'desc' })) }
              ]} />
              <LibraryToolbarMenu label={`${t('viewMode')}: ${t(view === 'grid' ? 'gridView' : 'listView')}${grouped ? ` · ${t('libraryGroup')}` : ''}`} icon={view} active={grouped} options={[
                ...(['grid', 'list'] as const).map((mode) => ({ label: t(mode === 'grid' ? 'gridView' : 'listView'), icon: mode, role: 'menuitemradio' as const, checked: view === mode, onSelect: () => switchLibraryView(mode) })),
                { label: t('libraryGroup'), icon: 'library', role: 'menuitemcheckbox', checked: grouped, disabled: !!query.trim(), hint: query.trim() ? t('librarySearchUngrouped') : t('libraryGroupHint'), divider: true, onSelect: () => setGrouped(!grouped) }
              ]} />
              <span className="library-toolbar-actions-divider" aria-hidden="true" />
              <button type="button" className={`library-action icon ${selectionMode ? 'active' : ''}`} aria-pressed={selectionMode} aria-label={selectionMode ? t('cancelSelection') : t('selectItems')} data-tooltip={selectionMode ? t('cancelSelection') : t('selectItems')} onClick={() => selectionMode ? leaveSelectionMode() : setSelectionMode(true)}><Icon name={selectionMode ? 'close' : 'check'} size={17} /></button>
              {currentMedia && <button type="button" className="library-action locate" aria-label={t('libraryLocatePlaying')} data-tooltip={t('libraryLocatePlaying')} onClick={locateCurrent}><Icon name="locate" size={17} /></button>}
              <button type="button" className="library-action icon" disabled={availabilityRefreshing} onClick={() => void refreshAvailability()} aria-busy={availabilityRefreshing} aria-label={checkFilesLabel} data-tooltip={checkFilesLabel}><Icon name="refresh" size={17} /></button>
            </div>
          </div>
          {searchOpen && (
            <div className="library-query-field library-search-dock">
              <Icon name="search" size={17} />
              <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('librarySearchHint')} aria-label={t('librarySearchHint')} />
              <button type="button" onClick={() => { if (query) { setQuery(''); searchRef.current?.focus() } else closeSearch() }} aria-label={query ? t('libraryClearSearch') : t('close')}><Icon name="close" size={15} /></button>
            </div>
          )}
          {selectionMode ? (
            <div className="library-batch-actions" role="group" aria-label={t('selectedCount', { count: selectedCards.length })}>
              <button type="button" className="library-action" disabled={!visibleMediaIds.length} onClick={toggleSelectAll}><Icon name={allVisibleSelected ? 'close' : 'check'} size={16} />{allVisibleSelected ? t('deselectAll') : t('selectAll')}</button>
              <span aria-live="polite">{t('selectedCount', { count: selectedCards.length })}</span>
              <button type="button" className="library-action" disabled={!selectedCards.length} onClick={() => void setFavorites(selectedCards.map((card) => card.item.id), !allSelectedFavorite).catch(() => toast('error', t('libraryActionFailed')))}><Icon name="heart" size={16} />{allSelectedFavorite ? t('unfavorite') : t('favorite')}</button>
              <button type="button" className="library-action" disabled={selectedCards.length < 2} onClick={() => void createCollection()}><Icon name="library" size={16} />{t('combineAsCollection')}</button>
              <button type="button" className="library-action danger" disabled={!selectedCards.length || busy} onClick={() => void removeSelected()}><Icon name="trash" size={16} />{t('removeFromLibrary')}</button>
            </div>
          ) : null}
        </div>
        <div ref={scrollRef} className="library-file-viewport" tabIndex={0} role="region" aria-label={filesTitle} onScroll={revealScrollbar} onWheel={revealScrollbar} onPointerMove={revealScrollbar} onFocusCapture={revealScrollbar}>
        {visibleCards.length > 0 ? (
          <div
            ref={gridRef}
            className={`library-file-grid ${view === 'list' ? 'list-view' : ''} ${selectionMode ? 'selection-mode' : ''}`}
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
                  className={`library-virtual-row ${row.expanded ? 'collection-expanded' : ''} ${row.collectionChild ? 'collection-children' : ''} ${row.firstCollectionRow ? 'collection-children-first' : ''}`}
                  style={{ transform: `translate3d(0, ${virtualRow.start - gridScrollMargin}px, 0)` }}
                >
                  {row.entries.map(({ entry, index }) => {
                    const expanded = entry.type === 'collection' && expandedCollections.has(entry.id)
                    return (
                      <div
                        key={displayEntryKey(entry)}
                        className={`library-entry-motion ${expanded ? 'collection-expanded' : ''}`}
                        data-item-reveal={displayEntryKey(entry)}
                        style={{ '--library-entry-index': Math.min(index, 8) } as React.CSSProperties}
                      >
                        {entry.type === 'item' ? (
                          <LibraryFileCard card={entry.card} current={entry.card.item.id === currentMediaId} selected={selectedMediaIds.has(entry.card.item.id)} selectionMode={selectionMode} onToggleFavorite={() => void toggleFavorite(entry.card.item.id)} onOpen={(event) => openCard(entry.card, event)} onContextMenu={(event) => openCardMenu(event, entry.card)} />
                        ) : (
                          <LibraryCollectionCard
                            collection={entry}
                            expanded={expanded}
                            onToggle={() => toggleCollection(entry.id)}
                            selectionMode={selectionMode}
                            selected={entry.cards.every((card) => selectedMediaIds.has(card.item.id))}
                            currentMediaId={currentMediaId}
                            onSelect={() => toggleSelected(entry.cards.map((card) => card.item.id))}
                            onCollectionContextMenu={openCollectionMenu}
                            collectionLabel={t('mediaCollection')}
                            itemLabel={t('collectionItems')}
                            expandLabel={t('expandCollection')}
                            collapseLabel={t('collapseCollection')}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="library-empty library-empty-state">
            <div className="library-empty-icon"><Icon name={libraryStats.total ? (kind === 'favorite' && !query && source === 'all' && !libraryStats.favorites ? 'heart' : 'search') : 'library'} size={32} /></div>
            <div>
              <strong>{libraryStats.total ? (kind === 'favorite' && !query && source === 'all' && !libraryStats.favorites ? t('libraryNoFavorites') : t('noMatchingMedia')) : t('libraryEmpty')}</strong>
              <span>{libraryStats.total ? (kind === 'favorite' && !query && source === 'all' && !libraryStats.favorites ? t('libraryFavoriteHint') : t('tryAnotherSearch')) : t('addMediaToStart')}</span>
            </div>
            <button type="button" className="library-action primary" onClick={() => libraryStats.total ? resetFilters() : void addMediaDialog()}>{libraryStats.total ? t('libraryResetFilters') : t('addMedia')}</button>
          </div>
        )}
        </div>
      </section>

    </main>
  )
}

export const LibraryPage = React.memo(LibraryPageView)

function LibraryCollectionCard({
  collection,
  expanded,
  onToggle,
  selectionMode,
  selected,
  currentMediaId,
  onSelect,
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
  currentMediaId: number | null
  onSelect: () => void
  onCollectionContextMenu: (event: React.MouseEvent, collection: Extract<LibraryDisplayEntry, { type: 'collection' }>) => void
  collectionLabel: string
  itemLabel: string
  expandLabel: string
  collapseLabel: string
}) {
  const previewCards = collection.cards.slice(0, 3)
  return (
    <section className={`library-collection ${expanded ? 'expanded' : ''} ${selected ? 'selected' : ''} ${collection.cards.some((card) => card.item.id === currentMediaId) ? 'contains-current' : ''}`} data-collection-id={collection.id}>
      <div className="library-collection-head">
        <button
          type="button"
          className="library-collection-summary"
          onClick={selectionMode ? onSelect : onToggle}
          onContextMenu={(event) => onCollectionContextMenu(event, collection)}
          aria-expanded={selectionMode ? undefined : expanded}
          aria-pressed={selectionMode ? selected : undefined}
          aria-label={`${selectionMode ? collectionLabel : expanded ? collapseLabel : expandLabel}: ${collection.title}`}
        >
          <span className="library-collection-art">
            {previewCards.map((card, index) => (
              <span className="library-collection-preview" key={card.item.id} style={{ '--preview-index': index } as React.CSSProperties}>
                {card.kind === 'audio' ? <AudioArtwork artwork={card.artwork} seed={card.item.id} thumbnail /> : card.artwork ? <ThumbnailImage src={card.artwork} alt="" loading="lazy" decoding="async" fetchPriority="low" /> : <span className="media-artwork-fallback compact"><Icon name="video" size={30} /></span>}
              </span>
            ))}
            {selectionMode && <span className="library-card-selection"><Icon name="check" size={14} /></span>}
            <span className="library-collection-count">{collection.cards.length}</span>
          </span>
          <span className="library-file-copy">
            <span className="library-file-title">{collection.title}</span>
            <span className="library-file-meta">
              <span>{collectionLabel}</span>
              <span className="library-file-meta-sep" aria-hidden="true">·</span>
              <span>{collection.cards.length} {itemLabel}</span>
              <Icon className="library-collection-chevron" name={expanded ? 'chevronUp' : 'chevronDown'} size={15} />
            </span>
          </span>
        </button>
        {!selectionMode && <button type="button" className="library-collection-more" aria-label={`${collection.title} · ${collectionLabel}`} aria-haspopup="menu" onClick={(event) => onCollectionContextMenu(event, collection)}><Icon name="more" size={17} /></button>}
      </div>
    </section>
  )
}

function LibraryFileCard({ card, current, selected, selectionMode, onToggleFavorite, onOpen, onContextMenu }: {
  card: LibraryCardData
  current: boolean
  selected: boolean
  selectionMode: boolean
  onToggleFavorite: () => void
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void
  onContextMenu: (event: React.MouseEvent) => void
}) {
  const { t, settings } = useLibraryRuntime()
  const favoriteLabel = card.item.favorite ? t('unfavorite') : t('favorite')
  const progress = settings?.resumePlayback !== false && card.item.duration > 0 ? Math.min(100, Math.max(0, card.item.lastPosition / card.item.duration * 100)) : 0
  const extension = card.item.fileName.split('.').at(-1)?.toUpperCase() || (card.kind === 'audio' ? 'AUDIO' : 'VIDEO')
  const sourceLabel = !card.item.sourceAvailable ? t('libraryUnavailable') : card.item.protocol === 'local' ? t('libraryLocal') : card.item.sourceName || t('libraryRemote')
  const sourceIcon = !card.item.sourceAvailable ? 'alert' : card.item.protocol === 'local' ? 'folder' : 'network'
  return (
    <div className={`library-file-card ${card.kind} ${selected ? 'selected' : ''} ${current ? 'is-current' : ''} ${!card.item.sourceAvailable ? 'is-unavailable' : ''}`} data-media-id={card.item.id} onContextMenu={onContextMenu}>
      <button type="button" className="library-file-open" onClick={onOpen} aria-label={`${selectionMode ? t('selectItem') : card.item.sourceAvailable ? t('play') : t('mediaInfo')}: ${card.title}`} aria-current={current ? 'true' : undefined} aria-pressed={selectionMode ? selected : undefined}>
        <span className={`library-file-art ${card.kind === 'audio' ? 'audio-art' : ''}`}>
          {card.kind === 'audio' ? <AudioArtwork artwork={card.artwork} seed={card.item.id} thumbnail /> : card.artwork ? <ThumbnailImage src={card.artwork} alt="" loading="lazy" decoding="async" fetchPriority="low" /> : <span className="media-artwork-fallback compact"><Icon name="video" size={31} /></span>}
          {!selectionMode && card.item.sourceAvailable && <span className="library-card-play"><Icon name="play" size={23} /></span>}
          {card.overlayDuration && <span className="library-file-duration">{card.overlayDuration}</span>}
          {selectionMode && <span className="library-card-selection"><Icon name="check" size={14} /></span>}
          {!selectionMode && current && <span className="library-playback-badge">{t('libraryPlaying')}</span>}
          {progress > 0 && <span className="library-card-progress"><span style={{ width: `${progress}%` }} /></span>}
        </span>
        <span className="library-file-copy">
          <span className="library-file-title" data-tooltip={card.title}>{card.title}</span>
          <span className="library-file-meta" data-tooltip={card.metadata}>
            <Icon name={sourceIcon} size={12} />
            <span className="library-file-meta-source">{sourceLabel}</span>
            <span className="library-file-meta-sep" aria-hidden="true">·</span>
            <span className="library-file-meta-primary">{card.kind === 'audio' ? card.item.artist || t('unknownArtist') : extension}</span>
          </span>
        </span>
        <span className="library-file-details">
          <span>{card.overlayDuration || '—'}</span>
          <span className="library-detail-size">{card.item.fileSize ? formatBytes(card.item.fileSize) : '—'}</span>
        </span>
      </button>
      {!selectionMode && (
        <div className="library-card-actions">
          <button type="button" className={`library-card-favorite ${card.item.favorite ? 'is-favorite' : ''}`} aria-label={favoriteLabel} data-tooltip={favoriteLabel} aria-pressed={card.item.favorite} onClick={onToggleFavorite}>
            {card.item.favorite ? <FilledIcon name="heartFilled" size={16} /> : <Icon name="heart" size={16} />}
          </button>
          <button type="button" className="library-card-more" aria-label={t('libraryMoreActions', { title: card.title })} data-tooltip={t('libraryMore')} aria-haspopup="menu" onClick={onContextMenu}><Icon name="more" size={16} /></button>
        </div>
      )}
    </div>
  )
}
