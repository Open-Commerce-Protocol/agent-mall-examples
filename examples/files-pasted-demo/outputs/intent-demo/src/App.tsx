import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowUp, Check, RotateCcw, Upload, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

type Stage = 'context' | 'market' | 'collective' | 'final'

const insights = [
  { copy: '“想拍一些有胶片感的照片”', source: 'from chats' },
  { copy: '不喜欢明显 Logo', source: '她的偏好' },
  { copy: '你偏好简单准备', source: '你的习惯' },
]

const offers = [
  { seller: 'Mori Camera', offer: 'Instax Mini 12 · 胶片 · 手写卡片', price: '¥699', openingPrice: '¥759' },
  { seller: 'Mono Jewelry', offer: '极简银项链 · 鲜花', price: '¥868', openingPrice: '¥898' },
  { seller: 'Moment', offer: 'Instax Mini 12 · 鲜花 · 手写卡片', price: '¥828' },
]

const poolSteps = [
  { buyers: 1, price: 699 },
  { buyers: 6, price: 669 },
  { buyers: 12, price: 639 },
  { buyers: 18, price: 609 },
]

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export default function App() {
  const [stage, setStage] = useState<Stage>('context')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState(0)
  const [hasContext, setHasContext] = useState(false)
  const [offerCount, setOfferCount] = useState(0)
  const [bestAdjusted, setBestAdjusted] = useState(false)
  const [secondAdjusted, setSecondAdjusted] = useState(false)
  const [buyerCount, setBuyerCount] = useState(1)
  const [groupPrice, setGroupPrice] = useState(699)
  const [accepted, setAccepted] = useState(false)
  const runId = useRef(0)
  const closeImportRef = useRef<HTMLButtonElement>(null)
  const reduceMotion = useReducedMotion()

  const restart = () => {
    runId.current += 1
    setStage('context')
    setImporting(false)
    setImportProgress(0)
    setHasContext(false)
    setOfferCount(0)
    setBestAdjusted(false)
    setSecondAdjusted(false)
    setBuyerCount(1)
    setGroupPrice(699)
    setAccepted(false)
  }

  const closeImport = () => {
    runId.current += 1
    setImporting(false)
  }

  const importChats = async () => {
    if (importing) return
    const id = ++runId.current
    setImporting(true)
    setImportProgress(0)
    for (const [progress, pause] of [[42, 520], [76, 580], [100, 620]] as const) {
      await wait(reduceMotion ? 80 : pause)
      if (runId.current !== id) return
      setImportProgress(progress)
    }
    await wait(reduceMotion ? 80 : 420)
    if (runId.current !== id) return
    setImporting(false)
    setHasContext(true)
  }

  const sendIntent = async () => {
    const id = ++runId.current
    setStage('market')
    setOfferCount(0)
    setBestAdjusted(false)
    setSecondAdjusted(false)
    await wait(reduceMotion ? 80 : 420)
    if (runId.current !== id) return
    setOfferCount(1)
    await wait(reduceMotion ? 80 : 480)
    if (runId.current !== id) return
    setBestAdjusted(true)
    await wait(reduceMotion ? 80 : 560)
    if (runId.current !== id) return
    setOfferCount(2)
    await wait(reduceMotion ? 80 : 620)
    if (runId.current !== id) return
    setOfferCount(3)
    await wait(reduceMotion ? 60 : 260)
    if (runId.current !== id) return
    setSecondAdjusted(true)
    await wait(reduceMotion ? 100 : 1500)
    if (runId.current !== id) return
    setStage('collective')
    setBuyerCount(1)
    setGroupPrice(699)
    for (const [count, price, pause] of [[6, 669, 540], [12, 639, 560], [18, 609, 660]] as const) {
      await wait(reduceMotion ? 80 : pause)
      if (runId.current !== id) return
      setBuyerCount(count)
      setGroupPrice(price)
    }
    await wait(reduceMotion ? 100 : 900)
    if (runId.current === id) setStage('final')
  }

  useEffect(() => () => { runId.current += 1 }, [])

  useEffect(() => {
    if (importing) closeImportRef.current?.focus()
  }, [importing])

  return (
    <div className={`app-shell ${stage === 'context' ? 'has-footer' : 'no-footer'}`}>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <header className="topbar">
        <button className="wordmark" onClick={restart} aria-label="返回 Intent 首页">
          <span className="brand-mark" aria-hidden="true"><span /></span>
          <span>Intent</span>
        </button>
        <div className="top-actions">
          {stage === 'context' ? (
            <button className="text-button" onClick={importChats} disabled={importing || hasContext}>
              {hasContext ? <Check size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
              {hasContext ? 'Chats imported' : 'Import chats'}
            </button>
          ) : (
            <button className="text-button" onClick={restart}>
              <RotateCcw size={15} aria-hidden="true" /> Restart demo
            </button>
          )}
        </div>
      </header>

      <main id="main" className={`main stage-${stage}`}>
        <AnimatePresence mode="wait">
          {stage === 'context' && (
            <motion.section key="context" className="context-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: .28 }}>
              <div className="intro-copy">
                <p className="quiet-index">01 / Context</p>
                <h1>What do you want<br />to make happen?</h1>
              </div>

              <div className="intent-composer">
                <label htmlFor="intent-input">Tell your agent</label>
                <div className="composer-row">
                  <input id="intent-input" defaultValue="女朋友明天过生日，预算 1000，帮我搞定。" />
                  <button className="send-button" onClick={sendIntent} aria-label="发送购买意图">
                    <ArrowUp size={17} strokeWidth={1.7} aria-hidden="true" />
                  </button>
                </div>
                {!hasContext && <p className="composer-context">Import chats to add personal context</p>}
                <AnimatePresence>
                  {hasContext && (
                    <motion.div className="context-trace" aria-live="polite" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .38 }}>
                      <div className="trace-heading"><span>Context from chats</span><span>3 signals found</span></div>
                      {insights.map((insight, index) => (
                        <motion.p key={insight.copy} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * .08 }}>
                          <span>{insight.copy}</span><small>{insight.source}</small>
                        </motion.p>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.section>
          )}

          {stage === 'market' && (
            <motion.section key="market" className="market-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: .3 }}>
              <IntentSummary />
              <div className="market-response">
                <div className="section-heading">
                  <div>
                    <p className="quiet-index">02 / Intent market</p>
                    <h2>The market is responding.</h2>
                  </div>
                  <span className="live-status"><i /> 8 sellers responding</span>
                </div>
                <div className="offer-header"><span>Seller / proposal</span><span>Delivery</span><span>Offer</span></div>
                <div className="offers" aria-live="polite">
                  {offers.slice(0, offerCount).map((offer, index) => {
                    const adjusted = index === 0 ? bestAdjusted : index === 1 ? secondAdjusted : true
                    const displayedPrice = adjusted ? offer.price : offer.openingPrice ?? offer.price
                    return (
                    <motion.div className={`offer-row ${index === 0 && bestAdjusted ? 'best-offer' : ''} ${index === 1 && secondAdjusted ? 'counter-offer' : ''}`} key={offer.seller} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .34 }}>
                      <span className="row-number">0{index + 1}</span>
                      <div><strong>{offer.seller}</strong><p>{offer.offer}</p></div>
                      <span>明日送达</span>
                      <span className="offer-quote">
                        <motion.strong className="offer-price" key={displayedPrice} initial={{ opacity: .28, y: -7 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .28 }}>
                          {displayedPrice}
                        </motion.strong>
                        {index === 0 && bestAdjusted && <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }}>↓ ¥60 · best</motion.small>}
                        {index === 1 && secondAdjusted && <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }}>↓ ¥30</motion.small>}
                      </span>
                    </motion.div>
                  )})}
                </div>
                <div className="market-note"><span>商家竞争这笔订单，不再竞争你的注意力。</span></div>
              </div>
            </motion.section>
          )}

          {(stage === 'collective' || stage === 'final') && (
            <motion.section key="collective" className="collective-stage" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .35 }}>
              <div className="collective-copy">
                <p className="quiet-index">03 / Collective buying</p>
                <h2>17 other buyer agents<br />share this intent.</h2>
                <p className="collective-explain">Buyer Agents 自动聚合相同需求，无需找人或进群。</p>
                <div className="stranger-line"><span>18 strangers</span><span>·</span><span>0 group chats</span><span>·</span><strong>1 shared intent</strong></div>
              </div>

              <div className="pool-visual" aria-label={`需求池已有 ${buyerCount} 位买家，当前团购价 ${groupPrice} 元`}>
                <svg className="pool-lines" viewBox="0 0 560 300" aria-hidden="true">
                  {[34, 78, 122, 166, 210, 254].map((y, i) => <path key={y} d={`M ${i % 2 ? 0 : 36} ${y} C 180 ${y}, 180 150, 280 150`} />)}
                  {[34, 78, 122, 166, 210, 254].map((y, i) => <path key={`r${y}`} d={`M ${i % 2 ? 560 : 524} ${y} C 380 ${y}, 380 150, 280 150`} />)}
                </svg>
                <div className="node-field" aria-hidden="true">
                  {Array.from({ length: 18 }).map((_, i) => <motion.i key={i} className={i === 0 ? 'you-node' : ''} initial={{ opacity: 0, scale: .4 }} animate={{ opacity: i < buyerCount ? 1 : .08, scale: i < buyerCount ? 1 : .7 }} transition={{ duration: .28, delay: Math.min(i * .018, .25) }} />)}
                </div>
                <div className="pool-center">
                  <span>Demand pool</span>
                  <motion.strong key={buyerCount} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>{buyerCount}</motion.strong>
                  <span>buyers</span>
                </div>
                <div className="leverage-track" aria-hidden="true">
                  {poolSteps.map((step) => (
                    <span key={step.buyers} className={buyerCount === step.buyers ? 'active' : buyerCount > step.buyers ? 'passed' : ''}>
                      <strong>{step.buyers}</strong><i>{step.buyers === 1 ? 'buyer' : 'buyers'}</i><em>¥{step.price}</em>
                    </span>
                  ))}
                </div>
                <div className={`price-drop ${buyerCount === 18 ? 'complete' : ''}`} aria-live="polite">
                  <motion.strong key={`${buyerCount}-${groupPrice}`} initial={{ opacity: .25, y: -7 }} animate={{ opacity: 1, y: 0 }}>
                    <span>{buyerCount} buyers</span><i>→</i><span>¥{groupPrice}</span>
                  </motion.strong>
                </div>
              </div>

              <AnimatePresence>
                {stage === 'final' && <Recommendation accepted={accepted} onAccept={() => setAccepted(true)} />}
              </AnimatePresence>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {stage === 'context' && <footer>
        <span>Your intent.</span><span>Your agent.</span><strong>Your market power.</strong>
      </footer>}

      <AnimatePresence>
        {importing && (
          <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="presentation">
            <motion.div className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title" onKeyDown={(event) => {
              if (event.key === 'Escape') closeImport()
              if (event.key === 'Tab') { event.preventDefault(); closeImportRef.current?.focus() }
            }} initial={{ opacity: 0, y: 18, scale: .985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}>
              <button ref={closeImportRef} className="close-button" onClick={closeImport} aria-label="关闭导入窗口"><X size={18} /></button>
              <p className="quiet-index">Context layer</p>
              <h2 id="import-title">Reading conversations</h2>
              <div className="file-line"><span>chat-export.zip</span><span>24.8 MB</span></div>
              <div className="progress-track"><motion.div animate={{ scaleX: importProgress / 100 }} transition={{ duration: .45, ease: [.22, 1, .36, 1] }} /></div>
              <div className="progress-value"><span>Finding the moments that matter</span><strong>{importProgress}%</strong></div>
              <p className="privacy-note">聊天内容只作为你的 Context Layer，不会被发送给商家。</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function IntentSummary() {
  return <aside className="intent-summary">
    <p className="quiet-index">Your intent</p>
    <h2>Birthday<br />tomorrow</h2>
    <div className="budget"><span>Budget</span><strong>¥1,000</strong></div>
    <div className="context-list">
      <span>Context</span>
      <p className="chat-signal">“想拍一些有胶片感的照片” <small>from chats</small></p><p>不喜欢明显 Logo</p><p>偏好简单准备</p><p>需要明日送达</p>
    </div>
  </aside>
}

function Recommendation({ accepted, onAccept }: { accepted: boolean; onAccept: () => void }) {
  return <motion.aside className="recommendation" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .38 }}>
    <div className="recommend-heading"><span>Recommended</span><span>New group offer · 12:00</span></div>
    <h3>Instax Mini 12</h3>
    <div className="receipt">
      <div><span>Group price</span><strong>¥609</strong></div>
      <div><span>Small bouquet</span><span>¥129</span></div>
      <div><span>Handwritten card</span><span>¥19</span></div>
      <div><span>Delivery</span><span>¥18</span></div>
      <div className="total"><strong>Total</strong><strong>¥775</strong></div>
      <div className="saved"><span>Saved</span><strong>¥151</strong></div>
    </div>
    <div className="why"><span>Why this</span><p>她提过胶片摄影；聚合需求让这份礼物更贴合，也更便宜。</p></div>
    <button className="accept-button" onClick={onAccept} disabled={accepted}>
      {accepted ? <><Check size={16} aria-hidden="true" /> Plan authorized</> : 'Authorize plan · ¥775'}
    </button>
    <small aria-live="polite">{accepted ? 'Demo complete — no order was placed.' : 'No order will be placed in this demo.'}</small>
  </motion.aside>
}
