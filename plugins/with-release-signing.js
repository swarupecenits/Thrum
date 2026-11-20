// Signs release builds with the private key described in credentials.json. `eas build` reads the same
// file when a profile sets "credentialsSource": "local", so local and EAS builds share one signature and
// can update each other. Without the file, release builds keep the template's debug signing.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// thrum: release signing';

const BLOCK = `
${MARKER} (plugins/with-release-signing.js)
def thrumCredentials = rootProject.file('../credentials.json')
if (thrumCredentials.exists()) {
    def thrumKeystore = new groovy.json.JsonSlurper().parse(thrumCredentials).android.keystore
    def thrumStoreFile = new File(thrumKeystore.keystorePath)
    android {
        signingConfigs {
            release {
                storeFile(thrumStoreFile.isAbsolute() ? thrumStoreFile : rootProject.file("../\${thrumKeystore.keystorePath}"))
                storePassword(thrumKeystore.keystorePassword)
                keyAlias(thrumKeystore.keyAlias)
                keyPassword(thrumKeystore.keyPassword ?: thrumKeystore.keystorePassword)
            }
        }
        buildTypes {
            release {
                signingConfig(signingConfigs.release)
            }
        }
    }
}
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('with-release-signing expects a Groovy app/build.gradle');
    }
    if (!cfg.modResults.contents.includes(MARKER)) cfg.modResults.contents += BLOCK;
    return cfg;
  });
};
