const DEFAULT_WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? "http://127.0.0.1:8787"
const WORKSPACE_ID = "demo-workspace"
const MIN_MESSAGES_PER_CHANNEL = Number(process.env.DEMO_MESSAGE_MIN ?? 58)
const MAX_MESSAGES_PER_CHANNEL = Number(process.env.DEMO_MESSAGE_MAX ?? 86)

const AUTHORS = {
  maya: "user-maya",
  theo: "user-theo",
  priya: "user-priya",
  jordan: "user-jordan",
  alex: "user-alex",
  sam: "user-sam",
}

const AUTHOR_ORDER = [
  AUTHORS.maya,
  AUTHORS.theo,
  AUTHORS.priya,
  AUTHORS.jordan,
  AUTHORS.alex,
  AUTHORS.sam,
]

const CHANNEL_CONFIG = {
  general: {
    openers: [
      "Good morning. Quick reminder that Friday's all-hands starts at 10 and the deck is almost locked.",
      "Morning everyone. If you still need budget approvals for next month, please send them by lunch.",
      "Heads up that the leadership update is going out this afternoon, so final comments need to land soon.",
      "Good morning. If your team has wins for the weekly recap, drop them here before 3.",
    ],
    subjects: [
      "the customer newsletter",
      "the Q2 planning deck",
      "next week's hiring loop",
      "the office lunch schedule",
      "the support queue",
      "the onboarding checklist",
      "the monthly forecast",
      "the brand refresh timeline",
      "the travel policy update",
      "the team offsite logistics",
    ],
    verbs: [
      "is in good shape",
      "still needs one more pass",
      "is moving faster than expected",
      "should be wrapped today",
      "is looking cleaner now",
      "needs tighter coordination",
      "is ready for sign-off",
      "is getting close",
      "could use one final review",
      "looks solid from my side",
    ],
    followUps: [
      "If you are blocked, say it early so we can fix it before the afternoon gets away from us.",
      "I'd rather have fewer surprises than a heroic scramble at the end of the day.",
      "Please leave comments in the doc instead of starting three side threads.",
      "Let's keep decisions in one place so nobody has to reconstruct context later.",
      "A boring, organized week is still my preferred outcome.",
      "If anything changes, post here so the rest of the team doesn't get stale information.",
      "The more explicit we are now, the smoother tomorrow will be.",
      "Small clarifications this morning save a lot of backtracking later.",
    ],
    threadPhrases: [
      "Thanks for keeping this thread updated without making me chase six tabs for context.",
      "This is why I like using this channel for cross-team stuff instead of burying it in meetings.",
      "I appreciate how quickly people are surfacing decisions here.",
      "This is exactly the kind of update that keeps the week from getting messy.",
      "A short note here is honestly better than another calendar invite.",
      "Glad this is staying visible instead of turning into hallway knowledge.",
      "This thread is doing more project management than half our templates.",
      "Thanks. This gives everyone a single place to stay aligned.",
    ],
  },
  random: {
    openers: [
      "I need everyone to know the office plant by the window has somehow doubled in size overnight.",
      "Important poll: if the snack drawer has one good thing left, do you take it or announce it.",
      "I have a very serious question about whether team playlists should be democratic.",
      "Whoever brought in the pastries this morning raised the bar unfairly high.",
    ],
    subjects: [
      "office dogs",
      "the snack shelf",
      "team playlists",
      "the lunch rotation",
      "people's commute rituals",
      "conference swag",
      "weekend plans",
      "the best coffee nearby",
      "deskside decorations",
      "accidental fashion coordination",
    ],
    verbs: [
      "deserves stronger opinions",
      "is getting more attention than expected",
      "has somehow become a recurring debate",
      "is carrying the mood today",
      "always gets funnier after one more opinion",
      "is weirdly divisive in this office",
      "is much more competitive than it should be",
      "is clearly a personality test in disguise",
      "has become today's main distraction",
      "is not getting settled anytime soon",
    ],
    followUps: [
      "I support any conversation that keeps the afternoon from feeling too corporate.",
      "Please do not let this turn into a spreadsheet unless absolutely necessary.",
      "Someone will absolutely make this more competitive than it needs to be.",
      "This is exactly the kind of low-stakes debate I expect from a healthy office.",
      "I would like at least one unserious answer before we pretend to be adults again.",
      "There is no reason this should matter as much as it does, and yet.",
      "I'm fully in favor of harmless workplace nonsense as a bonding strategy.",
      "This is the right amount of distraction for a Tuesday.",
    ],
    threadPhrases: [
      "Every company has at least one thread exactly like this and that feels healthy to me.",
      "This channel is doing important morale work whether leadership tracks it or not.",
      "I appreciate that we can spend five minutes on this and then go back to being competent adults.",
      "This is the sort of conversation that makes an office feel real instead of staged.",
      "Nobody can convince me that a little banter is not productive.",
      "This thread has exactly the right amount of chaos.",
      "I'm glad this room exists so these takes don't end up in general.",
      "A little low-stakes nonsense is part of the culture, actually.",
    ],
  },
  watercooler: {
    openers: [
      "Coffee report: excellent, maybe a little too effective.",
      "Watercooler check. How is everybody doing after that meeting block?",
      "Lunch planning starts now because if we wait until noon nobody decides anything.",
      "How are people feeling today, genuinely, not calendar-acceptance-wise.",
    ],
    subjects: [
      "coffee quality",
      "afternoon energy",
      "lunch plans",
      "the weather",
      "walk breaks",
      "desk snacks",
      "sleep schedules",
      "podcast recommendations",
      "tea loyalty",
      "after-work plans",
    ],
    verbs: [
      "is carrying the entire afternoon",
      "has become strangely important today",
      "is helping more than expected",
      "needs a better plan than vibes alone",
      "is holding the team together",
      "is proving unexpectedly controversial",
      "deserves more respect",
      "is either working perfectly or not at all",
      "has real supporters in this office",
      "is the difference between a good day and a bad one",
    ],
    followUps: [
      "I maintain that a short walk solves more problems than another ten minutes at the desk.",
      "At least one person here is running entirely on caffeine and good intentions.",
      "The team always seems calmer after someone suggests food.",
      "I support any ritual that makes the workday feel slightly more human.",
      "Nobody should have to pretend they are endlessly optimized.",
      "A quick check-in usually does more for morale than another status update.",
      "We should normalize stepping away from the screen before everyone gets weird.",
      "This room is quietly doing excellent emotional operations work.",
    ],
    threadPhrases: [
      "This is exactly the kind of channel that makes a workplace feel inhabited.",
      "If a room called watercooler isn't at least a little unserious, something has gone wrong.",
      "I appreciate that this space exists for people to sound like people.",
      "This is better than pretending everyone is permanently locked in.",
      "Beverage discourse is one of the last stable institutions.",
      "Snack recommendations might be our strongest form of collaboration.",
      "This thread is doing more for the vibe than any office furniture ever could.",
      "A little ambient humanity goes a long way around here.",
    ],
  },
  "new-biz": {
    openers: [
      "Quick pipeline check before the week gets away from us. Which deals actually need executive attention?",
      "Morning. I updated the prospect tracker and there are three accounts worth a closer look.",
      "I want to tighten up next week's outreach so we are not sending five different versions of the same story.",
      "Flagging that the retail prospect asked for pricing context sooner than expected.",
    ],
    subjects: [
      "the Q3 pipeline",
      "the retail prospect",
      "the healthcare intro",
      "next week's outreach",
      "the pricing deck",
      "the pilot proposal",
      "the procurement timeline",
      "the referral conversation",
      "the conference follow-up list",
      "the renewal forecast",
    ],
    verbs: [
      "looks promising",
      "needs cleaner follow-up",
      "is moving slower than I'd like",
      "could close this quarter",
      "needs more context before we push",
      "is still worth the effort",
      "is getting warmer",
      "needs a tighter story",
      "should be revisited next week",
      "looks healthier than it did on Monday",
    ],
    followUps: [
      "If we are going to spend time there, let's be clear about the next step and owner.",
      "I don't want enthusiasm without a concrete path to a decision.",
      "Please keep notes tight so we can scan this thread quickly before calls.",
      "A smaller number of well-run opportunities still beats a messy pile of maybes.",
      "If someone hears a budget signal, put it here immediately.",
      "Let's avoid making the account team reconstruct history from memory.",
      "I care more about clarity than volume right now.",
      "A clean handoff matters more than one extra hopeful email.",
    ],
    threadPhrases: [
      "This is why I like having pipeline notes here instead of scattered across private docs.",
      "A thread like this makes it much easier to walk into calls prepared.",
      "Thank you for putting real signal here instead of just green-check optimism.",
      "This is the kind of update sales ops keeps asking us for.",
      "Much easier to prioritize when everyone leaves a readable trail.",
      "A little discipline here saves a lot of confusion later in the week.",
      "This channel works best when the updates are short, factual, and actually useful.",
      "This gives us something concrete to work from instead of vibes.",
    ],
  },
}

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} failed: ${response.status}`)
  }
  return response.json()
}

async function listChannels() {
  const data = await fetchJson(`${DEFAULT_WORKER_ORIGIN}/api/channels`)
  return data.channels
}

async function listMessages(channelId) {
  const data = await fetchJson(`${DEFAULT_WORKER_ORIGIN}/api/channels/${channelId}/messages`)
  return data.messages
}

async function createMessage(channel, authorId, body) {
  const payload = {
    id: crypto.randomUUID(),
    mutationId: crypto.randomUUID(),
    workspaceId: channel.workspaceId ?? WORKSPACE_ID,
    channelId: channel.id,
    authorId,
    body,
  }

  await fetchJson(`${DEFAULT_WORKER_ORIGIN}/api/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  })
}

function hashString(value) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0
  }
  return hash
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function resolveTargetCount(channelId) {
  const min = Math.min(MIN_MESSAGES_PER_CHANNEL, MAX_MESSAGES_PER_CHANNEL)
  const max = Math.max(MIN_MESSAGES_PER_CHANNEL, MAX_MESSAGES_PER_CHANNEL)
  const spread = max - min + 1
  return min + (hashString(channelId) % spread)
}

function pick(list, index, salt = 0) {
  return list[(index + salt) % list.length]
}

function authorFor(channelId, index) {
  const offset = hashString(channelId) % AUTHOR_ORDER.length
  return AUTHOR_ORDER[(index + offset) % AUTHOR_ORDER.length]
}

function buildFallbackConfig(channel) {
  return {
    openers: [
      `Kicking off #${channel.id} so this room has a little real activity in it.`,
      `Using this channel for ${channel.name.toLowerCase()} updates going forward.`,
      `Starting a thread here so context stays visible instead of disappearing into DMs.`,
    ],
    subjects: [
      `${channel.name.toLowerCase()} planning`,
      `${channel.id} updates`,
      "follow-up notes",
      "small coordination tasks",
      "status checks",
      "next steps",
    ],
    verbs: [
      "is moving in the right direction",
      "still needs a little structure",
      "looks solid so far",
      "should stay lightweight",
      "is coming together",
      "works better with shared context",
    ],
    followUps: [
      "Let's keep updates here so nobody has to ask twice for context.",
      "A little consistency in this thread will make the week easier.",
      "Short updates here are better than decisions getting lost in side chats.",
      "This should be simple to scan when someone joins midstream.",
    ],
    threadPhrases: [
      "I like having one visible thread instead of scattered context.",
      "A little history here makes the room much more useful.",
      "Nothing fancy, just enough signal that people can stay aligned.",
      "This should be an easy place to catch up quickly.",
    ],
  }
}

function buildConversation(channel, targetCount) {
  const config = CHANNEL_CONFIG[channel.id] ?? buildFallbackConfig(channel)
  const messages = []

  messages.push([authorFor(channel.id, 0), pick(config.openers, 0)])
  messages.push([authorFor(channel.id, 1), pick(config.threadPhrases, 0)])

  for (let index = messages.length; index < targetCount; index += 1) {
    const authorId = authorFor(channel.id, index)
    const subject = pick(config.subjects, index, 1)
    const verb = pick(config.verbs, index, 3)
    const followUp = pick(config.followUps, index, 5)
    const thread = pick(config.threadPhrases, index, 7)
    const opener = pick(config.openers, index, 11)
    const variant = index % 6

    let body
    if (variant === 0) {
      body = `${subject} ${verb}. ${followUp}`
    } else if (variant === 1) {
      body = `${thread} ${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb}.`
    } else if (variant === 2) {
      body = `${opener} ${followUp}`
    } else if (variant === 3) {
      body = `Quick take: ${subject} ${verb}, and I think that's the right call for now.`
    } else if (variant === 4) {
      body = `I keep thinking about ${subject}. ${thread}`
    } else {
      body = `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb}. ${thread}`
    }

    messages.push([authorId, body])
  }

  return messages
}

async function seedChannel(channel) {
  const existingMessages = await listMessages(channel.id)
  const targetCount = clamp(resolveTargetCount(channel.id), 1, 500)

  if (existingMessages.length >= targetCount) {
    return {
      channelId: channel.id,
      targetCount,
      existingCount: existingMessages.length,
      seeded: 0,
      skipped: true,
    }
  }

  const conversation = buildConversation(channel, targetCount)
  const messagesToCreate = conversation.slice(existingMessages.length, targetCount)

  for (const [authorId, body] of messagesToCreate) {
    await createMessage(channel, authorId, body)
  }

  return {
    channelId: channel.id,
    targetCount,
    existingCount: existingMessages.length,
    seeded: messagesToCreate.length,
    skipped: false,
  }
}

async function main() {
  const channels = await listChannels()
  if (channels.length === 0) {
    console.log("No channels found.")
    return
  }

  console.log(
    `Seeding ${channels.length} channel(s) from ${DEFAULT_WORKER_ORIGIN} to roughly ${MIN_MESSAGES_PER_CHANNEL}-${MAX_MESSAGES_PER_CHANNEL} messages each`
  )

  for (const channel of channels) {
    const result = await seedChannel(channel)
    if (result.skipped) {
      console.log(
        `- ${result.channelId}: skipped (${result.existingCount} existing, target ${result.targetCount})`
      )
    } else {
      console.log(
        `- ${result.channelId}: added ${result.seeded} message(s) (${result.existingCount} -> ${result.targetCount})`
      )
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
