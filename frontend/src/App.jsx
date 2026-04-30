import { Fragment, useMemo, useState } from 'react'
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core'
import { io } from 'socket.io-client'
import * as icons from 'lucide-react'
import { Volume2, Copy, CheckCircle2, Link2, RotateCw, Ship } from 'lucide-react'
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

  async function createRoom() {
    setError('')
    const response = await withCallback('room:create', { playerName })
    if (!response?.ok) {
      setError(response?.error || 'Nie udało się utworzyć pokoju.')
      return
    }

    setRoomState(response.room)
    setShips(makeShipPool())
    const socket = getSocket()
    socket.off('room:state')
    socket.on('room:state', (nextState) => {
      setRoomState(nextState)
    })
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
    const socket = getSocket()
    socket.off('room:state')
    socket.on('room:state', (nextState) => {
      setRoomState(nextState)
    })
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

    const response = await withCallback('room:setReady', {
      roomId: roomState.roomId,
      ready,
    })

    if (!response?.ok) {
      setSetupError(response?.error || 'Nie udało się ustawić gotowości.')
      return
    }

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
                Etap 1: tworzenie i dołączanie do pokoju + plansza słów i ikon z odsłuchem.
              </p>
            </div>
          </div>
        </div>

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
                  {roomState.allPlayersReady && <div className="alert alert-success mt-3 mb-0">Obaj gracze gotowi. Kolejny etap: tury i strzały.</div>}
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
                    <div className="d-flex flex-wrap gap-2">
                      {ships.map((ship) => (
                        <ShipDraggable key={ship.id} ship={ship} onRotate={rotateShip} onReset={resetShip} />
                      ))}
                    </div>
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
      </section>
    </div>
  )
}

export default App
