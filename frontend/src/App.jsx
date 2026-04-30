import { Fragment, useMemo, useState } from 'react'
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { io } from 'socket.io-client'
import * as icons from 'lucide-react'
import { Volume2, Copy, CheckCircle2, Link2, RotateCw, Ship, Droplets, Flame, Skull } from 'lucide-react'
import boardConfig from './config/board.json'
import { speakWord } from './utils/speech'
import './App.css'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001'

let socketSingleton = null

function getSocket() {
  if (!socketSingleton) {
    socketSingleton = io(SOCKET_URL, {
      transports: ['websocket', 'polling'],
    })
  }
  return socketSingleton
}

function CoordinateChip({ item }) {
  const Icon = icons[item.icon] || icons.Square

  return (
    <button
      type="button"
      className="btn btn-outline-secondary d-flex align-items-center gap-2 coord-chip"
      title={item.label}
      onClick={() => speakWord(item.label)}
    >
      <Icon size={16} />
      <span>{item.label}</span>
      <Volume2 size={14} className="text-muted" />
    </button>
  )
}

function makeShipPool() {
  const ships = []
  let index = 1

  boardConfig.ships.forEach((group) => {
    for (let i = 0; i < group.count; i += 1) {
      ships.push({
        id: `ship-${index}`,
        size: group.size,
        orientation: 'horizontal',
        row: null,
        col: null,
      })
      index += 1
    }
  })

  return ships
}

function isPlaced(ship) {
  return ship.row !== null && ship.col !== null
}

function canPlaceShip(ship, startRow, startCol, occupied, boardSize) {
  const targetCells = []

  for (let i = 0; i < ship.size; i += 1) {
    const row = startRow + (ship.orientation === 'vertical' ? i : 0)
    const col = startCol + (ship.orientation === 'horizontal' ? i : 0)

    if (row >= boardSize || col >= boardSize) {
      return false
    }

    const key = `${row}-${col}`
    if (occupied[key] && occupied[key] !== ship.id) {
      return false
    }

    targetCells.push({ row, col })
  }

  for (const cell of targetCells) {
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const nearRow = cell.row + dr
        const nearCol = cell.col + dc
        if (nearRow < 0 || nearCol < 0 || nearRow >= boardSize || nearCol >= boardSize) {
          continue
        }

        const nearKey = `${nearRow}-${nearCol}`
        if (occupied[nearKey] && occupied[nearKey] !== ship.id) {
          return false
        }
      }
    }
  }

  return true
}

function getPreviewSegmentClass(cellKey, previewCells) {
  const index = previewCells.indexOf(cellKey)
  if (index === -1) {
    return ''
  }
  if (previewCells.length === 1) {
    return 'preview-segment-single'
  }
  if (index === 0) {
    return 'preview-segment-start'
  }
  if (index === previewCells.length - 1) {
    return 'preview-segment-end'
  }
  return 'preview-segment-middle'
}

function buildOccupiedMap(ships) {
  const map = {}

  ships.forEach((ship) => {
    if (!isPlaced(ship)) {
      return
    }

    for (let i = 0; i < ship.size; i += 1) {
      const row = ship.row + (ship.orientation === 'vertical' ? i : 0)
      const col = ship.col + (ship.orientation === 'horizontal' ? i : 0)
      map[`${row}-${col}`] = ship.id
    }
  })

  return map
}

function parseShipIdFromDragId(rawId) {
  if (typeof rawId !== 'string') {
    return null
  }

  if (rawId.startsWith('pool-')) {
    return rawId.slice(5)
  }

  if (rawId.startsWith('board-')) {
    return rawId.slice(6)
  }

  return null
}

function placeShipOnBoard(ship, startRow, startCol) {
  return {
    ...ship,
    row: startRow,
    col: startCol,
  }
}

function cellToShipInfo(cellKey, ships) {
  for (const ship of ships) {
    if (!isPlaced(ship)) {
      continue
    }

    for (let i = 0; i < ship.size; i += 1) {
      const row = ship.row + (ship.orientation === 'vertical' ? i : 0)
      const col = ship.col + (ship.orientation === 'horizontal' ? i : 0)
      const key = `${row}-${col}`
      if (key === cellKey) {
        return {
          ship,
          isHead: i === 0,
        }
      }
    }
  }

  return null
}

function ShipDraggable({ ship, onRotate, onReset }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `pool-${ship.id}`,
    disabled: isPlaced(ship),
  })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="ship-card border rounded p-2 bg-white shadow-sm">
      <div className="d-flex align-items-center justify-content-between gap-2">
        <button type="button" className="btn btn-sm btn-outline-primary" {...listeners} {...attributes} disabled={isPlaced(ship)}>
          <Ship size={14} /> Statek {ship.size}
        </button>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => onRotate(ship.id)}>
          <RotateCw size={14} />
        </button>
      </div>
      <div className="small text-muted mt-1">
        {ship.orientation === 'horizontal' ? 'Poziomo' : 'Pionowo'}
        {isPlaced(ship) ? ' • na planszy' : ' • do ustawienia'}
      </div>
      {isPlaced(ship) && (
        <button type="button" className="btn btn-link btn-sm px-0" onClick={() => onReset(ship.id)}>
          Zdejmij z planszy
        </button>
      )}
    </div>
  )
}

function BoardShipDraggable({ ship }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `board-${ship.id}`,
  })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <button
      ref={setNodeRef}
      style={style}
      type="button"
      className="ship-piece ship-piece-draggable"
      title={`Przesuń statek ${ship.size}`}
      {...listeners}
      {...attributes}
    >
      {ship.size}
    </button>
  )
}

function BoardCell({ id, children, previewStatus, previewSegmentClass }) {
  const { isOver, setNodeRef } = useDroppable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`board-cell ${isOver ? 'board-cell-over' : ''} ${previewStatus === 'valid' ? 'board-cell-preview-valid' : ''} ${previewStatus === 'invalid' ? 'board-cell-preview-invalid' : ''} ${previewSegmentClass || ''}`}
    >
      {children}
    </div>
  )
}

function StaticGameBoard({ ships, shotMarkers, isClickable, myTurn, onCellClick }) {
  const boardSize = boardConfig.boardSize

  const shipCellsMap = useMemo(() => {
    if (!ships) return {}
    const map = {}
    ships.forEach((ship) => {
      for (let i = 0; i < ship.size; i += 1) {
        const row = ship.row + (ship.orientation === 'vertical' ? i : 0)
        const col = ship.col + (ship.orientation === 'horizontal' ? i : 0)
        map[`${row}-${col}`] = ship.id
      }
    })
    return map
  }, [ships])

  return (
    <div className="board-wrap">
      <div className="board-grid" style={{ gridTemplateColumns: `90px repeat(${boardSize}, minmax(32px, 1fr))` }}>
        <div className="board-corner" />
        {boardConfig.columns.map((column) => {
          const Icon = icons[column.icon] || icons.Square
          return (
            <button key={column.id} type="button" className="board-axis" title={column.label} onClick={() => speakWord(column.label)}>
              <Icon size={16} />
            </button>
          )
        })}

        {boardConfig.rows.map((row, rowIndex) => {
          const RowIcon = icons[row.icon] || icons.Square
          return (
            <Fragment key={row.id}>
              <button key={`${row.id}-axis`} type="button" className="board-axis" title={row.label} onClick={() => speakWord(row.label)}>
                <RowIcon size={16} />
              </button>
              {boardConfig.columns.map((column, colIndex) => {
                const cellKey = `${rowIndex}-${colIndex}`
                const hasShip = Boolean(shipCellsMap[cellKey])
                const marker = shotMarkers?.[cellKey]
                const isShootable = isClickable && myTurn && !marker

                const classNames = [
                  'board-cell',
                  hasShip ? 'game-cell-own-ship' : '',
                  marker === 'hit' ? 'game-cell-hit' : '',
                  marker === 'miss' ? 'game-cell-miss' : '',
                  marker === 'sunk' ? 'game-cell-sunk' : '',
                  isShootable ? 'game-cell-shootable' : '',
                ].filter(Boolean).join(' ')

                return (
                  <div
                    key={`${row.id}-${column.id}`}
                    className={classNames}
                    role={isShootable ? 'button' : undefined}
                    tabIndex={isShootable ? 0 : undefined}
                    title={isShootable ? `${row.label} – ${column.label}` : undefined}
                    onClick={isShootable ? () => onCellClick(rowIndex, colIndex) : undefined}
                    onKeyDown={isShootable ? (e) => { if (e.key === 'Enter' || e.key === ' ') onCellClick(rowIndex, colIndex) } : undefined}
                  >
                    {marker === 'hit' && <Flame className="game-marker game-marker-hit" aria-hidden="true" />}
                    {marker === 'miss' && <Droplets className="game-marker game-marker-miss" aria-hidden="true" />}
                    {marker === 'sunk' && <Skull className="game-marker game-marker-sunk" aria-hidden="true" />}
                  </div>
                )
              })}
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}

function autoPlaceShips(shipPool, boardSize) {
  for (let retry = 0; retry < 30; retry += 1) {
    const newShips = shipPool.map((s) => ({ ...s, row: null, col: null, orientation: 'horizontal' }))
    let failed = false

    for (let i = 0; i < newShips.length; i += 1) {
      let placed = false

      for (let attempt = 0; attempt < 400; attempt += 1) {
        const orientation = Math.random() < 0.5 ? 'horizontal' : 'vertical'
        const maxRow = orientation === 'vertical' ? boardSize - newShips[i].size : boardSize - 1
        const maxCol = orientation === 'horizontal' ? boardSize - newShips[i].size : boardSize - 1
        if (maxRow < 0 || maxCol < 0) continue
        const row = Math.floor(Math.random() * (maxRow + 1))
        const col = Math.floor(Math.random() * (maxCol + 1))
        const candidate = { ...newShips[i], orientation, row, col }
        const occupied = buildOccupiedMap(newShips)
        if (canPlaceShip(candidate, row, col, occupied, boardSize)) {
          newShips[i] = candidate
          placed = true
          break
        }
      }

      if (!placed) { failed = true; break }
    }

    if (!failed) return newShips
  }
  return null
}

function App() {
  const [playerName, setPlayerName] = useState('')
  const [joinRoomId, setJoinRoomId] = useState('')
  const [roomState, setRoomState] = useState(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [ships, setShips] = useState(() => makeShipPool())
  const [setupError, setSetupError] = useState('')
  const [dragState, setDragState] = useState({ shipId: null, overCellId: null })

  const occupiedMap = useMemo(() => buildOccupiedMap(ships), [ships])

  const placementPreview = useMemo(() => {
    if (!dragState.shipId || !dragState.overCellId) {
      return { active: false, cells: [], isValid: false }
    }

    const ship = ships.find((item) => item.id === dragState.shipId)
    if (!ship) {
      return { active: false, cells: [], isValid: false }
    }

    const [rowText, colText] = dragState.overCellId.split('-')
    const startRow = Number(rowText)
    const startCol = Number(colText)
    if (Number.isNaN(startRow) || Number.isNaN(startCol)) {
      return { active: false, cells: [], isValid: false }
    }

    const cells = []
    for (let i = 0; i < ship.size; i += 1) {
      const row = startRow + (ship.orientation === 'vertical' ? i : 0)
      const col = startCol + (ship.orientation === 'horizontal' ? i : 0)
      cells.push(`${row}-${col}`)
    }

    return {
      active: true,
      cells,
      isValid: canPlaceShip(ship, startRow, startCol, occupiedMap, boardConfig.boardSize),
    }
  }, [dragState, ships, occupiedMap])

  const allShipsPlaced = ships.every((ship) => isPlaced(ship))
  const myPlayer = roomState?.players?.find((player) => player.id === getSocket().id)

  const game = roomState?.game ?? null
  const myId = getSocket().id
  const isMyTurn = game?.currentTurnPlayerId === myId

  const myShotsMap = useMemo(() => {
    const map = {}
    if (!game?.shots) return map
    for (const shot of game.shots) {
      if (shot.shooterId !== myId) continue
      map[`${shot.row}-${shot.col}`] = shot.result
      if (shot.result === 'sunk' && shot.sunkShipCells) {
        for (const cell of shot.sunkShipCells) {
          map[`${cell.row}-${cell.col}`] = 'sunk'
        }
      }
    }
    return map
  }, [game?.shots, myId])

  const opponentShotsMap = useMemo(() => {
    const map = {}
    if (!game?.shots) return map
    for (const shot of game.shots) {
      if (shot.shooterId === myId) continue
      map[`${shot.row}-${shot.col}`] = shot.result
    }
    return map
  }, [game?.shots, myId])

  const opponentShipsForReview = useMemo(() => {
    if (game?.phase !== 'finished' || !game?.boardByPlayerId) return null
    const opponentId = roomState?.players?.find((p) => p.id !== myId)?.id
    return opponentId ? game.boardByPlayerId[opponentId] : null
  }, [game, myId, roomState])

  const inviteUrl = useMemo(() => {
    if (!roomState?.roomId) {
      return ''
    }

    const url = new URL(window.location.href)
    url.searchParams.set('room', roomState.roomId)
    return url.toString()
  }, [roomState])

  function withCallback(eventName, payload) {
    return new Promise((resolve) => {
      const socket = getSocket()
      socket.emit(eventName, payload, (response) => resolve(response))
    })
  }

  function setupSocketListeners(socket) {
    socket.off('room:state')
    socket.off('game:started')
    socket.off('game:state')
    socket.on('room:state', (nextState) => {
      setRoomState((prev) => {
        if (prev?.game?.phase === 'finished' && nextState?.game?.phase === 'waiting') {
          setShips(makeShipPool())
          setSetupError('')
        }
        return nextState
      })
    })
    socket.on('game:started', (nextState) => { setRoomState(nextState) })
    socket.on('game:state', (nextState) => { setRoomState(nextState) })
  }

  async function createRoom() {
    setError('')
    const response = await withCallback('room:create', { playerName })
    if (!response?.ok) {
      setError(response?.error || 'Nie udało się utworzyć pokoju.')
      return
    }

    setRoomState(response.room)
    setShips(makeShipPool())
    setupSocketListeners(getSocket())
  }

  async function joinRoom() {
    setError('')
    const response = await withCallback('room:join', {
      roomId: joinRoomId,
      playerName,
    })

    if (!response?.ok) {
      setError(response?.error || 'Nie udało się dołączyć do pokoju.')
      return
    }

    setRoomState(response.room)
    setShips(makeShipPool())
    setupSocketListeners(getSocket())
  }

  function fillFromUrlRoom() {
    const url = new URL(window.location.href)
    const roomId = url.searchParams.get('room')
    if (roomId) {
      setJoinRoomId(roomId)
    }
  }

  async function copyInviteLink() {
    if (!inviteUrl) {
      return
    }
    await navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  function rotateShip(shipId) {
    setShips((prev) => {
      const occupiedFromPrev = buildOccupiedMap(prev)
      return prev.map((ship) => {
        if (ship.id !== shipId) {
          return ship
        }

        const nextOrientation = ship.orientation === 'horizontal' ? 'vertical' : 'horizontal'
        const rotatedShip = {
          ...ship,
          orientation: nextOrientation,
        }

        if (!isPlaced(ship)) {
          setSetupError('')
          return rotatedShip
        }

        if (!canPlaceShip(rotatedShip, ship.row, ship.col, occupiedFromPrev, boardConfig.boardSize)) {
          setSetupError('Po obrocie statek nachodziłby na inny statek albo byłby zbyt blisko.')
          return ship
        }

        setSetupError('')
        return rotatedShip
      })
    })
  }

  function resetShip(shipId) {
    setShips((prev) =>
      prev.map((ship) => {
        if (ship.id !== shipId) {
          return ship
        }
        return {
          ...ship,
          row: null,
          col: null,
        }
      }),
    )
  }

  function handleShipDrop(event) {
    const { active, over } = event
    if (!over) {
      setDragState({ shipId: null, overCellId: null })
      return
    }

    const shipId = parseShipIdFromDragId(String(active.id))
    if (!shipId) {
      setDragState({ shipId: null, overCellId: null })
      return
    }

    const cellId = String(over.id)
    const [rowText, colText] = cellId.split('-')
    const startRow = Number(rowText)
    const startCol = Number(colText)

    if (Number.isNaN(startRow) || Number.isNaN(startCol)) {
      setDragState({ shipId: null, overCellId: null })
      return
    }

    setShips((prev) => {
      const ship = prev.find((item) => item.id === shipId)
      if (!ship) {
        return prev
      }

      const occupiedFromPrev = buildOccupiedMap(prev)

      if (!canPlaceShip(ship, startRow, startCol, occupiedFromPrev, boardConfig.boardSize)) {
        setSetupError('Tu nie da się położyć statku. Statki nie mogą się stykać nawet rogami.')
        return prev
      }

      setSetupError('')
      return prev.map((item) => (item.id === shipId ? placeShipOnBoard(item, startRow, startCol) : item))
    })

    setDragState({ shipId: null, overCellId: null })
  }

  function handleDragStart(event) {
    const shipId = parseShipIdFromDragId(String(event.active.id))
    if (!shipId) {
      return
    }

    setDragState({ shipId, overCellId: null })
  }

  function handleDragOver(event) {
    const overCellId = event.over ? String(event.over.id) : null
    setDragState((prev) => ({ ...prev, overCellId }))
  }

  function handleDragCancel() {
    setDragState({ shipId: null, overCellId: null })
  }

  async function setReady(ready) {
    if (!roomState?.roomId) {
      return
    }

    const shipsPayload = ready
      ? ships.filter(isPlaced).map((ship) => ({
          id: ship.id,
          row: ship.row,
          col: ship.col,
          size: ship.size,
          orientation: ship.orientation,
        }))
      : undefined

    const response = await withCallback('room:setReady', {
      roomId: roomState.roomId,
      ready,
      ships: shipsPayload,
    })

    if (!response?.ok) {
      setSetupError(response?.error || 'Nie udało się ustawić gotowości.')
      return
    }

    setRoomState(response.room)
  }

  async function shoot(row, col) {
    if (!roomState?.roomId) return

    const rowLabel = boardConfig.rows[row]?.label
    const colLabel = boardConfig.columns[col]?.label
    if (rowLabel && colLabel) speakWord(`${rowLabel} ${colLabel}`)

    const response = await withCallback('game:shoot', { roomId: roomState.roomId, row, col })
    if (!response?.ok) return

    setRoomState(response.room)

    const updatedGame = response.room?.game
    const lastShot = updatedGame?.shots
      ? [...updatedGame.shots].reverse().find((s) => s.shooterId === myId)
      : null

    if (lastShot?.result === 'sunk') speakWord('Trafiony zatopiony')
    else if (lastShot?.result === 'hit') speakWord('Trafiony')
    else if (lastShot?.result === 'miss') speakWord('Pudło')

    if (updatedGame?.winnerPlayerId) {
      if (updatedGame.winnerPlayerId === myId) speakWord('Wygrałeś')
      else speakWord('Przegrałeś')
    }
  }

  async function rematch() {
    if (!roomState?.roomId) return
    const response = await withCallback('game:rematch', { roomId: roomState.roomId })
    if (!response?.ok) return
    setShips(makeShipPool())
    setSetupError('')
    setRoomState(response.room)
  }

  return (
    <div className="app-shell">
      <section className="container py-4 py-md-5">
        <div className="row justify-content-center">
          <div className="col-12 col-xl-10">
            <div className="hero-card p-4 p-md-5 mb-4">
              <h1 className="display-6 mb-2">Logopedyczne Statki</h1>
              <p className="lead mb-0">
                {game?.phase === 'playing' && (isMyTurn ? '👉 Twoja tura — wybierz cel na planszy przeciwnika!' : '⏳ Czekaj — tura przeciwnika...')}
                {game?.phase === 'finished' && (game.winnerPlayerId === myId ? '🎉 Wygrałeś! Gratulacje!' : '😢 Tym razem przegrałeś. Może następnym razem!')}
                {(!game || game.phase === 'waiting') && 'Ustaw statki i zaproś przyjaciela do gry!'}
              </p>
            </div>
          </div>
        </div>

        {/* ── GAME PHASE ─────────────────────────────────────────────── */}
        {(game?.phase === 'playing' || game?.phase === 'finished') && (
          <div className="row g-4 justify-content-center">
            <div className="col-12 col-lg-6">
              <div className="panel p-4 h-100">
                <h2 className="h5 mb-3">
                  🛡️ Twoja flota
                  <span className="ms-2 small text-muted fw-normal">
                    ({roomState?.players?.find((p) => p.id === myId)?.name ?? 'Ja'})
                  </span>
                </h2>
                <StaticGameBoard
                  ships={ships}
                  shotMarkers={opponentShotsMap}
                  isClickable={false}
                  myTurn={false}
                  onCellClick={null}
                />
              </div>
            </div>

            <div className="col-12 col-lg-6">
              <div className="panel p-4 h-100">
                <h2 className="h5 mb-3">
                  🎯 Wody przeciwnika
                  <span className="ms-2 small text-muted fw-normal">
                    ({roomState?.players?.find((p) => p.id !== myId)?.name ?? 'Przeciwnik'})
                  </span>
                </h2>
                {game.phase === 'playing' && !isMyTurn && (
                  <div className="alert alert-warning py-2 mb-3">⏳ Tura przeciwnika...</div>
                )}
                {game.phase === 'playing' && isMyTurn && (
                  <div className="alert alert-success py-2 mb-3">👆 Kliknij w komórkę, żeby strzelić!</div>
                )}
                {game.phase === 'finished' && (
                  <div className={`alert py-2 mb-3 ${game.winnerPlayerId === myId ? 'alert-success' : 'alert-danger'}`}>
                    {game.winnerPlayerId === myId ? '🎉 Wygrałeś!' : '😢 Tym razem przegrałeś.'}
                    <button type="button" className="btn btn-primary btn-sm ms-3" onClick={rematch}>
                      Zagraj jeszcze raz
                    </button>
                  </div>
                )}
                <StaticGameBoard
                  ships={opponentShipsForReview}
                  shotMarkers={myShotsMap}
                  isClickable={game.phase === 'playing'}
                  myTurn={isMyTurn}
                  onCellClick={shoot}
                />
              </div>
            </div>

            <div className="col-12">
              <div className="panel p-3">
                <div className="d-flex flex-wrap gap-2 justify-content-center align-items-center">
                  <span className="small text-muted">Słowa koordynatów:</span>
                  {boardConfig.rows.map((item) => (
                    <CoordinateChip key={item.id} item={item} />
                  ))}
                  {boardConfig.columns.map((item) => (
                    <CoordinateChip key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── LOBBY + SETUP PHASE ─────────────────────────────────────── */}
        {(!game || game.phase === 'waiting') && (
          <div className="row g-4 justify-content-center">
            <div className="col-12 col-lg-5">
              <div className="panel p-4 h-100">
                <h2 className="h4 mb-3">Pokój gry</h2>
                <div className="mb-3">
                  <label className="form-label">Imię gracza</label>
                  <input
                    className="form-control"
                    value={playerName}
                    onChange={(event) => setPlayerName(event.target.value)}
                    placeholder="Np. Tata"
                  />
                </div>

                <div className="d-grid gap-2 mb-3">
                  <button type="button" className="btn btn-primary" onClick={createRoom}>
                    Utwórz pokój
                  </button>
                </div>

                <div className="input-group mb-2">
                  <input
                    className="form-control"
                    value={joinRoomId}
                    onChange={(event) => setJoinRoomId(event.target.value)}
                    placeholder="Kod pokoju"
                  />
                  <button type="button" className="btn btn-outline-primary" onClick={joinRoom}>
                    Dołącz
                  </button>
                </div>

                <button type="button" className="btn btn-link px-0" onClick={fillFromUrlRoom}>
                  Wczytaj kod pokoju z linku
                </button>

                {error && <div className="alert alert-danger mt-3 mb-0">{error}</div>}

                {roomState && (
                  <div className="mt-4 room-box p-3">
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                      <strong>{roomState.roomId}</strong>
                      <span className={`badge ${roomState.isReady ? 'text-bg-success' : 'text-bg-warning'}`}>
                        {roomState.isReady ? '2 graczy - gotowe' : 'Czekam na 2. gracza'}
                      </span>
                    </div>

                    <div className="small text-muted mt-2 d-flex flex-wrap gap-2">
                      {(roomState.players || []).map((player) => (
                        <span key={player.id} className="badge text-bg-light border">
                          {player.name} ({player.role === 'host' ? 'host' : 'gość'}) {player.ready ? '✅' : '⏳'}
                        </span>
                      ))}
                    </div>

                    <div className="input-group mt-3">
                      <span className="input-group-text">
                        <Link2 size={14} />
                      </span>
                      <input className="form-control" value={inviteUrl} readOnly />
                      <button type="button" className="btn btn-outline-secondary" onClick={copyInviteLink}>
                        {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
                      </button>
                    </div>

                    <div className="mt-3 d-flex gap-2 flex-wrap">
                      <button
                        type="button"
                        className="btn btn-success btn-sm"
                        onClick={() => setReady(true)}
                        disabled={!allShipsPlaced || !roomState.isReady}
                      >
                        Jestem gotowy
                      </button>
                      <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setReady(false)}>
                        Cofnij gotowość
                      </button>
                    </div>
                    {roomState.allPlayersReady && <div className="alert alert-success mt-3 mb-0">Obaj gracze gotowi — trwa uruchamianie gry...</div>}
                  </div>
                )}
              </div>
            </div>

            <div className="col-12 col-lg-5">
              <div className="panel p-4 h-100">
                <h2 className="h4 mb-3">Plansza ustawiania statków ({boardConfig.boardSize}x{boardConfig.boardSize})</h2>

                <DndContext onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleShipDrop} onDragCancel={handleDragCancel}>
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="d-flex flex-wrap gap-2 align-items-start">
                        {ships.map((ship) => (
                          <ShipDraggable key={ship.id} ship={ship} onRotate={rotateShip} onReset={resetShip} />
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm mt-2"
                        onClick={() => {
                          const placed = autoPlaceShips(makeShipPool(), boardConfig.boardSize)
                          if (placed) { setShips(placed); setSetupError('') }
                        }}
                      >
                        🎲 Ustaw Statki Losowo
                      </button>
                    </div>

                    <div className="col-12">
                      <div className="board-wrap">
                        <div className="board-grid" style={{ gridTemplateColumns: `90px repeat(${boardConfig.boardSize}, minmax(32px, 1fr))` }}>
                          <div className="board-corner" />
                          {boardConfig.columns.map((column) => {
                            const Icon = icons[column.icon] || icons.Square
                            return (
                              <button
                                key={column.id}
                                type="button"
                                className="board-axis"
                                title={column.label}
                                onClick={() => speakWord(column.label)}
                              >
                                <Icon size={16} />
                              </button>
                            )
                          })}

                          {boardConfig.rows.map((row, rowIndex) => {
                            const Icon = icons[row.icon] || icons.Square
                            return (
                              <Fragment key={row.id}>
                                <button
                                  key={`${row.id}-axis`}
                                  type="button"
                                  className="board-axis"
                                  title={row.label}
                                  onClick={() => speakWord(row.label)}
                                >
                                  <Icon size={16} />
                                </button>
                                {boardConfig.columns.map((column, colIndex) => {
                                  const cellKey = `${rowIndex}-${colIndex}`
                                  const shipInfo = cellToShipInfo(cellKey, ships)
                                  const inPreview = placementPreview.active && placementPreview.cells.includes(cellKey)
                                  const previewStatus = inPreview ? (placementPreview.isValid ? 'valid' : 'invalid') : null
                                  const previewSegmentClass = inPreview ? getPreviewSegmentClass(cellKey, placementPreview.cells) : ''
                                  return (
                                    <BoardCell key={`${row.id}-${column.id}`} id={cellKey} previewStatus={previewStatus} previewSegmentClass={previewSegmentClass}>
                                      {shipInfo && (
                                        shipInfo.isHead ? (
                                          <BoardShipDraggable ship={shipInfo.ship} />
                                        ) : (
                                          <div className="ship-piece ship-piece-body" title={`Statek ${shipInfo.ship.size}`} />
                                        )
                                      )}
                                    </BoardCell>
                                  )
                                })}
                              </Fragment>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                </DndContext>

                {setupError && <div className="alert alert-warning mt-3 mb-0">{setupError}</div>}
                {myPlayer?.ready && <div className="alert alert-info mt-3 mb-0">Twoja gotowość ustawiona.</div>}

                <hr className="my-4" />

                <h3 className="h6">Słowa koordynatów</h3>

                <p className="small text-muted mb-2">Pion (wiersze)</p>
                <div className="d-flex flex-wrap gap-2 mb-3">
                  {boardConfig.rows.map((item) => (
                    <CoordinateChip key={item.id} item={item} />
                  ))}
                </div>

                <p className="small text-muted mb-2">Poziom (kolumny)</p>
                <div className="d-flex flex-wrap gap-2">
                  {boardConfig.columns.map((item) => (
                    <CoordinateChip key={item.id} item={item} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

export default App
