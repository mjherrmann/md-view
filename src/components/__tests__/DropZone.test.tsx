import { render, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { DropZone } from '../DropZone'
import { DND_FILE_MIME, DND_GROUP_MIME, DND_VERSION_MIME } from '../../dnd'

/**
 * Helper: build a minimal DataTransfer-like object for drop events.
 * jsdom doesn't implement DataTransfer fully, so we craft it manually.
 */
function createDataTransfer(opts: {
  items?: Array<{
    kind: string
    type: string
    webkitGetAsEntry?: () => FileSystemEntry | null
    getAsFile?: () => File | null
  }>
  files?: File[]
  types?: string[]
}): DataTransfer {
  const files = opts.files ?? []
  const types = opts.types ?? []

  const fileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < files.length; i++) yield files[i]
    },
  } as unknown as FileList

  // Add numeric index access
  for (let i = 0; i < files.length; i++) {
    ;(fileList as Record<number, File>)[i] = files[i]
  }

  const items = opts.items ?? []
  const itemList = {
    length: items.length,
    [Symbol.iterator]: function* () {
      for (let i = 0; i < items.length; i++) yield items[i]
    },
  } as unknown as DataTransferItemList

  for (let i = 0; i < items.length; i++) {
    ;(itemList as Record<number, (typeof items)[number]>)[i] = items[i]
  }

  return {
    items: itemList,
    files: fileList,
    types,
    getData: (t: string) => (types.includes(t) ? 'mock' : ''),
    setData: vi.fn(),
    clearData: vi.fn(),
    dropEffect: 'none',
    effectAllowed: 'all',
  } as unknown as DataTransfer
}

function makeMdFile(name = 'test.md'): File {
  return new File(['# hello'], name, { type: 'text/markdown' })
}

function makeDirectoryEntry(name = 'my-folder'): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: vi.fn(),
    createReader: vi.fn(),
  } as unknown as FileSystemDirectoryEntry
}

function makeFileEntry(name = 'file.md'): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${name}`,
    filesystem: {} as FileSystem,
    getParent: vi.fn(),
    file: vi.fn(),
  } as unknown as FileSystemFileEntry
}

describe('DropZone directory detection', () => {
  describe('webkitGetAsEntry fallback (Req 1.4)', () => {
    it('uses DataTransfer.files when webkitGetAsEntry unavailable', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()
      const mdFile = makeMdFile()

      const dt = createDataTransfer({
        // items with NO webkitGetAsEntry
        items: [
          {
            kind: 'file',
            type: 'text/markdown',
            getAsFile: () => mdFile,
          },
        ],
        files: [mdFile],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      const dropTarget = container.firstElementChild!
      fireEvent.drop(dropTarget, { dataTransfer: dt })

      expect(onFiles).toHaveBeenCalledWith([mdFile])
      expect(onDirectories).not.toHaveBeenCalled()
    })

    it('skips non-readable files in fallback mode', () => {
      const onFiles = vi.fn()
      const binaryFile = new File(['bytes'], 'image.png', {
        type: 'image/png',
      })

      const dt = createDataTransfer({
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => binaryFile }],
        files: [binaryFile],
      })

      const { container } = render(
        <DropZone onFiles={onFiles}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).not.toHaveBeenCalled()
    })
  })

  describe('internal drag guard (Req 1.3)', () => {
    it('ignores internal file drags', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()

      const dt = createDataTransfer({
        items: [],
        files: [makeMdFile()],
        types: [DND_FILE_MIME],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).not.toHaveBeenCalled()
      expect(onDirectories).not.toHaveBeenCalled()
    })

    it('ignores internal group drags', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()

      const dt = createDataTransfer({
        items: [],
        files: [],
        types: [DND_GROUP_MIME],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).not.toHaveBeenCalled()
      expect(onDirectories).not.toHaveBeenCalled()
    })

    it('ignores internal version drags', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()

      const dt = createDataTransfer({
        items: [],
        files: [],
        types: [DND_VERSION_MIME],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).not.toHaveBeenCalled()
      expect(onDirectories).not.toHaveBeenCalled()
    })
  })

  describe('mixed drop dispatch (Req 1.2)', () => {
    it('fires both onFiles and onDirectories for mixed drops', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()
      const mdFile = makeMdFile()
      const dirEntry = makeDirectoryEntry('docs')
      const fileEntry = makeFileEntry('readme.md')

      const dt = createDataTransfer({
        items: [
          {
            kind: 'file',
            type: '',
            webkitGetAsEntry: () => dirEntry,
            getAsFile: () => null,
          },
          {
            kind: 'file',
            type: 'text/markdown',
            webkitGetAsEntry: () => fileEntry,
            getAsFile: () => mdFile,
          },
        ],
        files: [mdFile],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onDirectories).toHaveBeenCalledWith([dirEntry])
      expect(onFiles).toHaveBeenCalledWith([mdFile])
    })
  })

  describe('directory-only and file-only drops (Req 1.1)', () => {
    it('fires only onDirectories for directory-only drop', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()
      const dirEntry = makeDirectoryEntry('project')

      const dt = createDataTransfer({
        items: [
          {
            kind: 'file',
            type: '',
            webkitGetAsEntry: () => dirEntry,
            getAsFile: () => null,
          },
        ],
        files: [],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onDirectories).toHaveBeenCalledWith([dirEntry])
      expect(onFiles).not.toHaveBeenCalled()
    })

    it('fires only onFiles for file-only drop with webkitGetAsEntry', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()
      const mdFile = makeMdFile()
      const fileEntry = makeFileEntry('test.md')

      const dt = createDataTransfer({
        items: [
          {
            kind: 'file',
            type: 'text/markdown',
            webkitGetAsEntry: () => fileEntry,
            getAsFile: () => mdFile,
          },
        ],
        files: [mdFile],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).toHaveBeenCalledWith([mdFile])
      expect(onDirectories).not.toHaveBeenCalled()
    })

    it('skips non-readable files when classifying via webkitGetAsEntry', () => {
      const onFiles = vi.fn()
      const onDirectories = vi.fn()
      const pngFile = new File(['bytes'], 'pic.png', { type: 'image/png' })
      const fileEntry = makeFileEntry('pic.png')

      const dt = createDataTransfer({
        items: [
          {
            kind: 'file',
            type: 'image/png',
            webkitGetAsEntry: () => fileEntry,
            getAsFile: () => pngFile,
          },
        ],
        files: [pngFile],
      })

      const { container } = render(
        <DropZone onFiles={onFiles} onDirectories={onDirectories}>
          <span>drop here</span>
        </DropZone>,
      )

      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).not.toHaveBeenCalled()
      expect(onDirectories).not.toHaveBeenCalled()
    })

    it('does not call onDirectories when prop not provided', () => {
      const onFiles = vi.fn()
      const dirEntry = makeDirectoryEntry('stuff')

      const dt = createDataTransfer({
        items: [
          {
            kind: 'file',
            type: '',
            webkitGetAsEntry: () => dirEntry,
            getAsFile: () => null,
          },
        ],
        files: [],
      })

      const { container } = render(
        <DropZone onFiles={onFiles}>
          <span>drop here</span>
        </DropZone>,
      )

      // Should not throw when onDirectories is undefined
      fireEvent.drop(container.firstElementChild!, { dataTransfer: dt })

      expect(onFiles).not.toHaveBeenCalled()
    })
  })
})
