/**
 * @typedef {import('mdast').Link} Link
 * @typedef {import('mdast').PhrasingContent} PhrasingContent
 *
 * @typedef {import('mdast-util-from-markdown').CompileContext} CompileContext
 * @typedef {import('mdast-util-from-markdown').Extension} FromMarkdownExtension
 * @typedef {import('mdast-util-from-markdown').Handle} FromMarkdownHandle
 * @typedef {import('mdast-util-from-markdown').Transform} FromMarkdownTransform
 *
 * @typedef {import('mdast-util-to-markdown').ConstructName} ConstructName
 * @typedef {import('mdast-util-to-markdown').Options} ToMarkdownExtension
 *
 * @typedef {import('mdast-util-find-and-replace').RegExpMatchObject} RegExpMatchObject
 * @typedef {import('mdast-util-find-and-replace').ReplaceFunction} ReplaceFunction
 */

import {ccount} from 'ccount'
import {ok as assert} from 'devlop'
import {unicodePunctuation, unicodeWhitespace} from 'micromark-util-character'
import {findAndReplace} from 'mdast-util-find-and-replace'

/** @type {ConstructName} */
const inConstruct = 'phrasing'
/** @type {Array<ConstructName>} */
const notInConstruct = ['autolink', 'link', 'image', 'label']

/**
 * @typedef Options
 *   Configuration.
 * @property {string} connectedInstance
 *   The lemmy instance the user is connected to, e.g. `"lemmy.world"`
 */

/**
 * Create an extension for `mdast-util-from-markdown` to enable GFM autolink
 * literals in markdown.
 *
 * @param {Options} options
 * @returns {FromMarkdownExtension}
 *   Extension for `mdast-util-to-markdown` to enable GFM autolink literals.
 */
export function gfmAutolinkLiteralFromMarkdown(options) {
  const transformGfmAutolinkLiterals = buildTransformGfmAutolinkLiterals(
    options.connectedInstance
  )

  return {
    transforms: [transformGfmAutolinkLiterals],
    enter: {
      literalAutolink: enterLiteralAutolink,
      literalAutolinkEmail: enterLiteralAutolinkValue,
      literalAutolinkHttp: enterLiteralAutolinkValue,
      literalAutolinkWww: enterLiteralAutolinkValue
    },
    exit: {
      literalAutolink: exitLiteralAutolink,
      literalAutolinkEmail: exitLiteralAutolinkEmail,
      literalAutolinkHttp: exitLiteralAutolinkHttp,
      literalAutolinkWww: exitLiteralAutolinkWww
    }
  }
}

/**
 * Create an extension for `mdast-util-to-markdown` to enable GFM autolink
 * literals in markdown.
 *
 * @returns {ToMarkdownExtension}
 *   Extension for `mdast-util-to-markdown` to enable GFM autolink literals.
 */
export function gfmAutolinkLiteralToMarkdown() {
  return {
    unsafe: [
      {
        character: '@',
        before: '[+\\-.\\w]',
        after: '[\\-.\\w]',
        inConstruct,
        notInConstruct
      },
      {
        character: '.',
        before: '[Ww]',
        after: '[\\-.\\w]',
        inConstruct,
        notInConstruct
      },
      {
        character: ':',
        before: '[ps]',
        after: '\\/',
        inConstruct,
        notInConstruct
      }
    ]
  }
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterLiteralAutolink(token) {
  this.enter({type: 'link', title: null, url: '', children: []}, token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function enterLiteralAutolinkValue(token) {
  this.config.enter.autolinkProtocol.call(this, token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitLiteralAutolinkHttp(token) {
  this.config.exit.autolinkProtocol.call(this, token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitLiteralAutolinkWww(token) {
  this.config.exit.data.call(this, token)
  const node = this.stack[this.stack.length - 1]
  assert(node.type === 'link')
  node.url = 'http://' + this.sliceSerialize(token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitLiteralAutolinkEmail(token) {
  this.config.exit.autolinkEmail.call(this, token)
}

/**
 * @this {CompileContext}
 * @type {FromMarkdownHandle}
 */
function exitLiteralAutolink(token) {
  this.exit(token)
}

/**
 * @param {string} connectedInstance
 */
function buildTransformGfmAutolinkLiterals(connectedInstance) {
  const findCommunityShebang = buildFindCommunity(connectedInstance, '!')
  const findCommunityRelativeLink = buildFindCommunity(connectedInstance, '/c/')
  const findUser = buildFindUser(connectedInstance, '@')
  const findUserRelativeLink = buildFindUser(connectedInstance, '/u/')

  /**
   * @type {FromMarkdownTransform}
   * */
  function transformGfmAutolinkLiterals(tree) {
    findAndReplace(
      tree,
      [
        [/(https?:\/\/|www(?=\.))([-.\w]+)([^ \t\r\n]*)/gi, findUrl],
        [/(![-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g, findCommunityShebang],
        [/(\/c\/[-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g, findCommunityRelativeLink],
        [/(@[-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g, findUser],
        [/(\/u\/[-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g, findUserRelativeLink],
        [/([-.\w+]+)@([-\w]+(?:\.[-\w]+)+)/g, findEmail]
      ],
      {ignore: ['link', 'linkReference']}
    )
  }

  return transformGfmAutolinkLiterals
}

/**
 * @type {ReplaceFunction}
 * @param {string} _
 * @param {string} protocol
 * @param {string} domain
 * @param {string} path
 * @param {RegExpMatchObject} match
 * @returns {Array<PhrasingContent> | Link | false}
 */
// eslint-disable-next-line max-params
function findUrl(_, protocol, domain, path, match) {
  let prefix = ''

  // Not an expected previous character.
  if (!previous(match)) {
    return false
  }

  // Treat `www` as part of the domain.
  if (/^w/i.test(protocol)) {
    domain = protocol + domain
    protocol = ''
    prefix = 'http://'
  }

  if (!isCorrectDomain(domain)) {
    return false
  }

  const parts = splitUrl(domain + path)

  if (!parts[0]) return false

  /** @type {Link} */
  const result = {
    type: 'link',
    title: null,
    url: prefix + protocol + parts[0],
    children: [{type: 'text', value: protocol + parts[0]}]
  }

  if (parts[1]) {
    return [result, {type: 'text', value: parts[1]}]
  }

  return result
}

/**
 * @param {string} connectedInstance
 * @param {string} prefix
 */
function buildFindCommunity(connectedInstance, prefix) {
  /**
   * @type {ReplaceFunction}
   * @param {string} _
   * @param {string} atext
   * @param {string} label
   * @param {RegExpMatchObject} match
   * @returns {Link | false}
   */
  function findCommunity(_, atext, label, match) {
    if (
      // Not an expected previous character.
      !previous(match, true) ||
      // Label ends in not allowed character.
      /[-\d_]$/.test(label)
    ) {
      return false
    }

    const communityName = atext.slice(prefix.length)
    const server = label

    return {
      type: 'link',
      title: null,
      url: `https://${connectedInstance}/c/${communityName}@${server}`,
      children: [{type: 'text', value: `${prefix}${communityName}@${server}`}]
    }
  }

  return findCommunity
}

/**
 * @param {string} connectedInstance
 * @param {string} prefix
 */
function buildFindUser(connectedInstance, prefix) {
  /**
   * @type {ReplaceFunction}
   * @param {string} _
   * @param {string} atext
   * @param {string} label
   * @param {RegExpMatchObject} match
   * @returns {Link | false}
   */
  function findUser(_, atext, label, match) {
    if (
      // Not an expected previous character.
      !previous(match, true) ||
      // Label ends in not allowed character.
      /[-\d_]$/.test(label)
    ) {
      return false
    }

    const userName = atext.slice(prefix.length)
    const server = label

    return {
      type: 'link',
      title: null,
      url: `https://${connectedInstance}/u/${userName}@${server}`,
      children: [{type: 'text', value: `${prefix}${userName}@${server}`}]
    }
  }

  return findUser
}

/**
 * @type {ReplaceFunction}
 * @param {string} _
 * @param {string} atext
 * @param {string} label
 * @param {RegExpMatchObject} match
 * @returns {Link | false}
 */
function findEmail(_, atext, label, match) {
  if (
    // Not an expected previous character.
    !previous(match, true) ||
    // Label ends in not allowed character.
    /[-\d_]$/.test(label)
  ) {
    return false
  }

  // Before the "email" is an ! or @
  const code = match.input.charCodeAt(match.index - 1)
  if (code === 33 || code === 64) return false

  return {
    type: 'link',
    title: null,
    url: 'mailto:' + atext + '@' + label,
    children: [{type: 'text', value: atext + '@' + label}]
  }
}

/**
 * @param {string} domain
 * @returns {boolean}
 */
function isCorrectDomain(domain) {
  const parts = domain.split('.')

  if (
    parts.length < 2 ||
    parts.some((part) => !part) ||
    (parts[parts.length - 1] &&
      (/_/.test(parts[parts.length - 1]) ||
        !/[a-zA-Z\d]/.test(parts[parts.length - 1]))) ||
    (parts[parts.length - 2] &&
      (/_/.test(parts[parts.length - 2]) ||
        !/[a-zA-Z\d]/.test(parts[parts.length - 2])))
  ) {
    return false
  }

  return true
}

/**
 * @param {string} url
 * @returns {[string, string | undefined]}
 */
function splitUrl(url) {
  const trailExec = /[!"&'),.:;<>?\]}]+$/.exec(url)

  if (!trailExec) {
    return [url, undefined]
  }

  url = url.slice(0, trailExec.index)

  let trail = trailExec[0]
  let closingParenIndex = trail.indexOf(')')
  const openingParens = ccount(url, '(')
  let closingParens = ccount(url, ')')

  while (closingParenIndex !== -1 && openingParens > closingParens) {
    url += trail.slice(0, closingParenIndex + 1)
    trail = trail.slice(closingParenIndex + 1)
    closingParenIndex = trail.indexOf(')')
    closingParens++
  }

  return [url, trail]
}

/**
 * @param {RegExpMatchObject} match
 * @param {boolean | null | undefined} [email=false]
 * @returns {boolean}
 */
function previous(match, email) {
  const code = match.input.charCodeAt(match.index - 1)

  return (
    (match.index === 0 ||
      unicodeWhitespace(code) ||
      unicodePunctuation(code)) &&
    (!email || code !== 47)
  )
}
