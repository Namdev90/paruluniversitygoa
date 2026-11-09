"""Shared, toolchain-independent checks for the app-owned Android Opus library."""
import struct

# ABI: NDK compiler prefix, configure host, ELF class, ELF machine.
ABIS = {
    'arm64-v8a': ('aarch64-linux-android', 'aarch64-linux-android', 2, 183),
    'armeabi-v7a': ('armv7a-linux-androideabi', 'arm-linux-androideabi', 1, 40),
    'x86_64': ('x86_64-linux-android', 'x86_64-linux-android', 2, 62),
    'x86': ('i686-linux-android', 'i686-linux-android', 1, 3),
}
JNI_EXPORTS = {
    'Java_in_navrang_gate_BundledRelayEncoder_nativeCreate',
    'Java_in_navrang_gate_BundledRelayEncoder_nativeEncode',
    'Java_in_navrang_gate_BundledRelayEncoder_nativeDestroy',
}


def inspect_elf(data, abi):
    """Fail closed on wrong architecture, alignment, dependencies or JNI exports.

    This is artifact inspection, not Android runtime or physical-device acceptance.
    The section tables emitted by the pinned NDK (including after strip) are required.
    """
    def require(ok, message):
        if not ok:
            raise ValueError(f'{abi}: {message}')

    def unpack(fmt, offset):
        require(0 <= offset <= len(data) - struct.calcsize(fmt), 'truncated ELF structure')
        return struct.unpack_from(fmt, data, offset)

    def region(offset, size):
        require(0 <= offset <= len(data) and 0 <= size <= len(data) - offset, 'invalid ELF range')
        return data[offset:offset + size]

    def string(table, offset):
        require(0 <= offset < len(table), 'invalid ELF string offset')
        end = table.find(b'\0', offset)
        require(end >= 0, 'unterminated ELF string')
        return table[offset:end].decode('ascii')

    require(abi in ABIS, 'unsupported ABI')
    elf_class, machine = ABIS[abi][2:]
    require(len(data) >= 16 and data[:4] == b'\x7fELF', 'not an ELF library')
    require(data[4:7] == bytes([elf_class, 1, 1]), 'wrong ELF class, endianness or version')
    is64 = elf_class == 2
    header = unpack('<HHIQQQIHHHHHH' if is64 else '<HHIIIIIHHHHHH', 16)
    require(header[:3] == (3, machine, 1), 'expected shared library for the selected architecture')
    phoff, shoff = header[4:6]
    phsize, phcount, shsize, shcount = header[8:12]
    require(phsize == (56 if is64 else 32) and 0 < phcount < 65535, 'invalid program-header table')
    require(shsize == (64 if is64 else 40) and 0 < shcount < 65535, 'missing section table')
    alignments = []
    for index in range(phcount):
        entry = unpack('<IIQQQQQQ' if is64 else '<IIIIIIII', phoff + index * phsize)
        kind = entry[0]
        require(kind != 3, 'shared library must not have an executable interpreter')
        if kind != 1:  # PT_LOAD
            continue
        if is64:
            offset, address, size, memory, alignment = entry[2], entry[3], entry[5], entry[6], entry[7]
        else:
            offset, address, size, memory, alignment = entry[1], entry[2], entry[4], entry[5], entry[7]
        region(offset, size)
        require(size <= memory, 'invalid load segment size')
        require(alignment >= 16384 and alignment & (alignment - 1) == 0,
                'load segment is not aligned for 16 KiB pages')
        require(offset % alignment == address % alignment, 'load segment offset/address mismatch')
        alignments.append(alignment)
    require(alignments, 'no loadable segments')
    sections = [unpack('<IIQQQQIIQQ' if is64 else '<IIIIIIIIII', shoff + index * shsize)
                for index in range(shcount)]
    exports, needed = set(), set()
    for section in sections:
        kind, offset, size, link, stride = section[1], section[4], section[5], section[6], section[9]
        if kind not in (6, 11):  # SHT_DYNAMIC, SHT_DYNSYM
            continue
        require(0 <= link < len(sections) and sections[link][1] == 3, 'missing linked string table')
        strings = region(sections[link][4], sections[link][5])
        expected = (16 if is64 else 8) if kind == 6 else (24 if is64 else 16)
        require(stride == expected and size % stride == 0, 'invalid dynamic entry size')
        region(offset, size)
        for entry_offset in range(offset, offset + size, stride):
            if kind == 6:
                tag, value = unpack('<qQ' if is64 else '<iI', entry_offset)
                require(tag != 22 and not (tag == 30 and value & 4), 'text relocations are forbidden')
                if tag == 1:
                    needed.add(string(strings, value))
            else:
                symbol = unpack('<IBBHQQ' if is64 else '<IIIBBH', entry_offset)
                name = symbol[0]
                info, other, defined = symbol[1:4] if is64 else symbol[3:6]
                if defined and info >> 4 in (1, 2) and other & 3 in (0, 3):
                    exports.add(string(strings, name))
    require(exports == JNI_EXPORTS, 'expected exactly the three encoder JNI exports')
    require(needed <= {'libc.so', 'libm.so', 'libdl.so'}, 'unexpected native dependency')
    return {'elfBits': 64 if is64 else 32, 'elfMachine': machine,
            'minimumLoadAlignment': min(alignments), 'jniExports': sorted(exports),
            'neededLibraries': sorted(needed)}
