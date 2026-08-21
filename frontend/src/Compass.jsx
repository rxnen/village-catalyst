import { useState } from 'react'

const ACCENT = '#9A3412'
const COMPLETE = '#3F6212'

const STAGES = [
  {
    id: 'readiness',
    name: 'Community Readiness',
    status: 'complete',
    description:
      'Confirm the group is organized, shares a purpose, and is prepared to take on a village.',
    summary:
      'Eight congregations formed the coalition, agreed on 12 to 20 homes, and named a convener.',
  },
  {
    id: 'land',
    name: 'Land Identification',
    status: 'current',
    description:
      'Find parcels that could physically hold a village and are realistic to pursue.',
    questions: [
      'Which parcels in Oakland, Berkeley, Hayward, or San Leandro could physically hold 12 to 20 homes?',
      'Is any of this land publicly owned?',
      'Which sites sit close enough to transit, groceries, and services that residents could live without a car?',
      'Are there environmental or slope constraints we would have to work around?',
      'If a site looks promising, who would we need to approach first?',
    ],
  },
  {
    id: 'feasibility',
    name: 'Site Feasibility',
    status: 'upcoming',
    description:
      'Test whether a shortlisted site can actually support a village: utilities, access, neighbors, and constraints.',
  },
  {
    id: 'design',
    name: 'Design and Configuration',
    status: 'upcoming',
    description:
      'Decide how homes, shared spaces, and site layout fit the land and the people who will live there.',
  },
  {
    id: 'budget',
    name: 'Budget and Funding',
    status: 'upcoming',
    description:
      'Build a complete cost picture and match it to grants, donations, and operating support.',
  },
  {
    id: 'permitting',
    name: 'Permitting and Approvals',
    status: 'upcoming',
    description:
      'Identify which agencies must say yes, and in what order, before anyone can move in.',
  },
]

const LAND_TASKS = [
  {
    status: 'complete',
    title: 'Define site requirements',
    why: 'A village of 12 to 20 homes needs a minimum footprint, relatively level ground, and street access. Writing this down first keeps the search from drifting toward sites that cannot work.',
  },
  {
    status: 'complete',
    title: 'Note publicly owned land of interest',
    why: 'City, county, and surplus sites are often the only parcels a community group can realistically pursue. Flagging them early shapes who the coalition will need to talk to.',
  },
  {
    status: 'current',
    title: 'Run parcel screening',
    why: 'County parcel records can rule out land that is too small, too steep, or in the wrong use category before anyone walks a site or calls an owner.',
  },
  {
    status: 'pending',
    title: 'Review candidate sites',
    why: 'Screening produces a list, not a decision. The coalition still has to look at each remaining parcel on the ground and with neighbors in mind.',
  },
  {
    status: 'pending',
    title: 'Verify ownership records',
    why: 'Assessor data is a starting point. Confirming who actually holds title, and whether the parcel is surplus, leased, or encumbered, prevents wasted outreach.',
  },
  {
    status: 'pending',
    title: 'Contact property owners',
    why: 'A promising parcel only becomes a project if the owner is willing to talk. This step is later on purpose: it should follow a short, defensible list.',
  },
]

const GUIDANCE = [
  {
    title: 'Why land is usually the hardest step',
    body: 'Most village projects do not stall first on design, or even on money. They stall on land. A group can spend a year building trust, drafting a vision, and lining up volunteers, then discover that every site they hear about is too small, too steep, still in use, or not actually available. This stage turns a hopeful idea into a short list of places that could physically work. Until that list exists, every other conversation is hypothetical.',
    source: 'Village Catalyst Playbook, Ch. 3',
  },
  {
    title: 'What makes a parcel viable',
    body: 'A viable parcel is not simply vacant. For a village of 12 to 20 homes it needs enough ground for private units plus shared facilities, relatively level topography, legal access from a street, and a location where people can reach food, transit, and services without a car. Parcels that fail those tests tend to fail later, in the budget and in neighbor relations. Screening for them now is an act of respect for everyone’s time.',
    source: 'Grounded Solutions Network, Site Criteria for Interim Housing (2023)',
  },
  {
    title: 'What publicly owned land means for acquisition',
    body: 'Public land (city, county, special district, or surplus school property) is often the only realistic path for a community group that cannot compete on the open market. Acquisition may be a long-term ground lease or a surplus-land transfer rather than a purchase. That changes the budget, and it also changes the process: the owner is an elected body or public agency, so the path runs through staff reports, noticed hearings, and Surplus Land Act rules, not a private negotiation alone.',
    source: 'California HCD, Surplus Land Act Guidelines (2024)',
  },
]

const BUDGET_ROWS = [
  'Site preparation',
  'Unit construction',
  'Shared facilities',
  'Utilities',
  'Permitting and fees',
]

const STATUS_LABEL = {
  complete: 'Complete',
  current: 'In progress',
  upcoming: 'Not started',
}

function CheckIcon({ className, color = COMPLETE }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill={color} />
      <path
        d="M6 10.2l2.4 2.4L14.2 7"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function StageMark({ index, status }) {
  if (status === 'complete') {
    return <CheckIcon className="h-6 w-6 shrink-0" />
  }
  if (status === 'current') {
    return (
      <span
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[13px] font-medium text-white"
        style={{ background: ACCENT }}
      >
        {index + 1}
      </span>
    )
  }
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-stone-400 text-[13px] font-medium text-stone-500">
      {index + 1}
    </span>
  )
}

function Header({ screen, onBack }) {
  const crumb =
    screen === 'land'
      ? 'Land Identification'
      : screen === 'budget'
        ? 'Budget and Funding'
        : null

  return (
    <header className="grid h-20 grid-cols-[280px_1fr_auto] items-center border-b border-stone-300 bg-[#F3F1EC] px-12">
      <div>
        <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-stone-500">
          Catalyst
        </p>
        <p className="mt-0.5 text-[15px] text-stone-600">Village planning guide</p>
      </div>
      <div className="justify-self-center">
        {crumb && (
          <nav className="flex items-center gap-3 text-[16px] text-stone-500">
            <button
              type="button"
              onClick={onBack}
              className="text-stone-600 underline decoration-stone-400 underline-offset-4 hover:text-stone-900"
            >
              Project roadmap
            </button>
            <span aria-hidden="true">/</span>
            <span className="text-stone-900">{crumb}</span>
          </nav>
        )}
      </div>
      <div className="text-right">
        <p className="text-[18px] font-medium text-stone-900">
          East Bay Interfaith Coalition
        </p>
        <p className="mt-0.5 text-[15px] text-stone-600">
          Tiny Village Project · Started March 12, 2026
        </p>
      </div>
    </header>
  )
}

function ScreeningHeader({ onBack }) {
  return (
    <header className="flex h-16 items-center justify-between border-b border-stone-300 bg-[#F3F1EC] px-12">
      <div className="flex items-baseline gap-6">
        <p className="text-[13px] font-medium uppercase tracking-[0.18em] text-stone-500">
          Catalyst
        </p>
        <p className="text-[16px] text-stone-800">
          East Bay Interfaith Coalition · Tiny Village Project
        </p>
        <span className="text-stone-400" aria-hidden="true">
          ·
        </span>
        <p className="text-[16px] text-stone-800">
          Land Identification
          <span className="ml-2 text-stone-500">/ Parcel screening</span>
        </p>
      </div>
      <button
        type="button"
        onClick={onBack}
        className="text-[16px] text-stone-600 underline decoration-stone-400 underline-offset-4 hover:text-stone-900"
      >
        Return to stage
      </button>
    </header>
  )
}

function Roadmap({ onOpenLand, onOpenBudget }) {
  const current = STAGES.find((stage) => stage.status === 'current')

  return (
    <main className="grid h-[calc(100vh-80px)] grid-cols-[460px_1fr]">
      <section className="overflow-y-auto border-r border-stone-300 px-8 py-8">
        <p className="mb-6 text-[16px] leading-relaxed text-stone-600">
          The coalition is locating land for a village of 12 to 20 homes in
          Oakland, Berkeley, Hayward, and San Leandro.
        </p>
        <ol className="relative">
          <div
            className="absolute top-3 bottom-3 left-[11px] w-px bg-stone-300"
            aria-hidden="true"
          />
          {STAGES.map((stage, index) => {
            const isCurrent = stage.status === 'current'
            const isComplete = stage.status === 'complete'
            const isBudget = stage.id === 'budget'

            return (
              <li key={stage.id} className="relative mb-2 pl-11 last:mb-0">
                <div className="absolute top-4 left-0 z-10 flex h-6 w-6 items-center justify-center bg-[#F3F1EC]">
                  <StageMark index={index} status={stage.status} />
                </div>
                <article
                  className={
                    isCurrent
                      ? 'border border-[#E8D5C8] bg-[#FBF6F2] px-4 py-3.5'
                      : 'border border-stone-300 bg-[#FFFEFB] px-4 py-3.5'
                  }
                >
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-[16px] font-medium text-stone-900">
                      {stage.name}
                    </h2>
                    <p
                      className={
                        isCurrent
                          ? 'shrink-0 text-[14px] font-medium'
                          : 'shrink-0 text-[14px] text-stone-500'
                      }
                      style={isCurrent ? { color: ACCENT } : undefined}
                    >
                      {STATUS_LABEL[stage.status]}
                    </p>
                  </div>
                  <p className="mt-1 text-[14px] leading-snug text-stone-600">
                    {isComplete ? stage.summary : stage.description}
                  </p>
                  {isBudget && (
                    <button
                      type="button"
                      onClick={onOpenBudget}
                      className="mt-2 text-[14px] text-stone-600 underline decoration-stone-400 underline-offset-4 hover:text-stone-900"
                    >
                      Preview budget structure
                    </button>
                  )}
                </article>
              </li>
            )
          })}
        </ol>
      </section>

      <section className="px-14 py-10">
        <p className="text-[15px] font-medium" style={{ color: ACCENT }}>
          In progress
        </p>
        <h1 className="mt-2 text-[28px] font-medium text-stone-900">
          {current.name}
        </h1>
        <p className="mt-3 max-w-[560px] text-[17px] leading-relaxed text-stone-600">
          {current.description}
        </p>

        <h2 className="mt-8 text-[16px] font-medium text-stone-800">
          Questions this stage needs to resolve
        </h2>
        <ol className="mt-4 max-w-[620px] space-y-3.5">
          {current.questions.map((question, qIndex) => (
            <li
              key={question}
              className="flex gap-3 text-[17px] leading-relaxed text-stone-800"
            >
              <span
                className="mt-0.5 w-5 shrink-0 text-[16px] text-stone-500"
                aria-hidden="true"
              >
                {qIndex + 1}.
              </span>
              <span>{question}</span>
            </li>
          ))}
        </ol>
        <button
          type="button"
          onClick={onOpenLand}
          className="mt-10 px-5 py-3 text-[16px] font-medium text-white"
          style={{ background: ACCENT }}
        >
          Continue land identification
        </button>
      </section>
    </main>
  )
}

function TaskStatus({ status }) {
  if (status === 'complete') {
    return (
      <span className="flex items-center gap-2 text-[14px] text-stone-600">
        <CheckIcon className="h-4 w-4" />
        Done
      </span>
    )
  }
  if (status === 'current') {
    return (
      <span className="text-[14px] font-medium" style={{ color: ACCENT }}>
        Now
      </span>
    )
  }
  return <span className="text-[14px] text-stone-400">Pending</span>
}

function LandStage({ onOpenScreening }) {
  return (
    <main className="grid h-[calc(100vh-80px)] grid-cols-[340px_1fr_360px] gap-0">
      <section className="overflow-y-auto border-r border-stone-300 px-8 py-8">
        <h1 className="text-[20px] font-medium text-stone-900">
          Work in this stage
        </h1>
        <p className="mt-2 text-[16px] leading-relaxed text-stone-600">
          Concrete steps for locating land. Parcel screening is the step in
          front of the coalition now.
        </p>
        <ol className="mt-6">
          {LAND_TASKS.map((task) => (
            <li
              key={task.title}
              className={
                task.status === 'current'
                  ? 'border-l-2 py-4 pl-4'
                  : 'border-l-2 border-transparent py-4 pl-4'
              }
              style={
                task.status === 'current'
                  ? { borderLeftColor: ACCENT }
                  : undefined
              }
            >
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[16px] font-medium text-stone-900">
                  {task.title}
                </h2>
                <TaskStatus status={task.status} />
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-600">
                {task.why}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex items-center justify-center bg-[#EDEBE6] px-12">
        <div className="w-full max-w-[520px] border border-dashed border-stone-400 bg-[#F7F5F0] px-10 py-12">
          <p className="text-[13px] font-medium uppercase tracking-[0.14em] text-stone-500">
            Connects to the screening tool
          </p>
          <h1 className="mt-3 text-[22px] font-medium text-stone-900">
            Parcel screening results
          </h1>
          <p className="mt-4 text-[16px] leading-relaxed text-stone-600">
            Candidate parcels appear here after they are screened against the
            requirements this coalition has already defined. This panel is the
            handoff into the live screening tool. It does not generate results
            on its own.
          </p>
          <button
            type="button"
            onClick={onOpenScreening}
            className="mt-8 px-5 py-3 text-[16px] font-medium text-white"
            style={{ background: ACCENT }}
          >
            Open screening tool
          </button>
        </div>
      </section>

      <aside className="overflow-y-auto border-l border-stone-300 px-8 py-8">
        <h1 className="text-[20px] font-medium text-stone-900">Guidance</h1>
        <p className="mt-2 text-[16px] leading-relaxed text-stone-600">
          Context for this stage, drawn from village planning practice.
        </p>
        <div className="mt-6 space-y-8">
          {GUIDANCE.map((passage) => (
            <article key={passage.title}>
              <h2 className="text-[16px] font-medium text-stone-900">
                {passage.title}
              </h2>
              <p className="mt-2 text-[15px] leading-relaxed text-stone-700">
                {passage.body}
              </p>
              <p className="mt-3 text-[14px] text-stone-500">{passage.source}</p>
            </article>
          ))}
        </div>
      </aside>
    </main>
  )
}

function BudgetStage() {
  return (
    <main className="mx-auto w-[860px] py-12">
      <p className="text-[15px] font-medium uppercase tracking-[0.14em] text-stone-500">
        Not started
      </p>
      <h1 className="mt-2 text-[26px] font-medium text-stone-900">
        Budget and Funding
      </h1>
      <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed text-stone-600">
        This stage comes after a site is chosen. The categories below are what a
        complete village budget will need to cover. Amounts are entered here
        from site-specific estimates. None have been prepared yet.
      </p>

      <div className="mt-10 border-t border-stone-300">
        {BUDGET_ROWS.map((row) => (
          <div
            key={row}
            className="flex items-baseline justify-between border-b border-stone-300 py-5"
          >
            <p className="text-[17px] text-stone-900">{row}</p>
            <p className="w-28 text-right text-[17px] tracking-widest text-stone-400">
              -
            </p>
          </div>
        ))}
      </div>
    </main>
  )
}

export default function Catalyst() {
  const [screen, setScreen] = useState('roadmap')

  if (screen === 'screening') {
    return (
      <div className="min-h-screen w-full bg-[#F3F1EC] font-sans text-stone-900">
        <ScreeningHeader onBack={() => setScreen('land')} />
        <iframe
          src="/"
          title="Parcel screening tool"
          className="block h-[calc(100vh-64px)] w-full border-0"
        />
      </div>
    )
  }

  return (
    <div className="mx-auto min-h-screen w-[1440px] bg-[#F3F1EC] font-sans text-stone-900">
      <Header screen={screen} onBack={() => setScreen('roadmap')} />
      {screen === 'roadmap' && (
        <Roadmap
          onOpenLand={() => setScreen('land')}
          onOpenBudget={() => setScreen('budget')}
        />
      )}
      {screen === 'land' && (
        <LandStage onOpenScreening={() => setScreen('screening')} />
      )}
      {screen === 'budget' && <BudgetStage />}
    </div>
  )
}
