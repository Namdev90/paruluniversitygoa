import {test} from 'node:test';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
test('every Python release tool parses without executing or reading signing material',()=>{
 const tools=fileURLToPath(new URL('../../tools/',import.meta.url));
 execFileSync('python3',['-c','import ast,pathlib,sys\nfor path in pathlib.Path(sys.argv[1]).glob("*.py"):\n ast.parse(path.read_text(), filename=str(path))',tools],{stdio:'pipe',timeout:10000});
});
