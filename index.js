// https://github.com/magico13/PyEmVue

const CognitoSDK = require("amazon-cognito-identity-js-node");
const fetch = require("node-fetch");

const AWS_CLIENTID = "4qte47jbstod8apnfic0bunmrq";
const AWS_USERPOOLID = "us-east-2_ghlOXVLi1";
const AWS_REGION = "us-east-2";

function kwhs2w(v) {
    return 60 * 60 * 1000 * v;
}

class Api {

    constructor(username, password) {
        this.username = username;
        this.password = password;
        this.idtoken = null;
        this.access = null;
        this.refresh = null;
    }

    async login() {
        const tokens = await new Promise((resolve, reject) => {
            const cuser = new CognitoSDK.CognitoUser({
                Pool: new CognitoSDK.CognitoUserPool({
                    ClientId: AWS_CLIENTID,
                    UserPoolId: AWS_USERPOOLID
                }),
                Username: this.username
            });
            cuser.authenticateUser(new CognitoSDK.AuthenticationDetails({
                Username: this.username,
                Password: this.password
            }),
            {
                onSuccess: resolve,
                onFailure: reject,
                newPasswordRequired: (attr) => {
					cuser.completeNewPasswordChallenge(attr.Password, { email: attr.email });
                }
            })
        });
        this.idtoken = tokens.idToken.jwtToken;
        this.access = tokens.accessToken.jwtToken;
        this.refresh = tokens.refreshToken.token;
        return this;
	}

    async refreshTokens() {
        const res = await fetch(`https://cognito-idp.${AWS_REGION}.amazonaws.com/`, {
            method: "POST",
            headers: {
                "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
				"Content-Type": "application/x-amz-json-1.1"
            },
            body: JSON.stringify({
                ClientId: AWS_CLIENTID,
				AuthFlow: "REFRESH_TOKEN_AUTH",
				AuthParameters: {
                    SECRET_HASH: AWS_USERPOOLID,
					REFRESH_TOKEN: this.refresh
				}
            })
        });
        const json = await res.json();
        const tokens = json.AuthenticationResult;
        if (tokens.AccessToken) {
            this.access = tokens.AccessToken;
        }
        if (tokens.IdToken) {
            this.idtoken = tokens.IdToken;
        }
    }

    async getDevices() {
        let res = await fetch("https://api.emporiaenergy.com/customers/devices", {
            method: "GET",
            headers: {
                authtoken: this.idtoken
            }
        });
        if (res.status === 401) {
            await this.refreshTokens();
            res = await fetch("https://api.emporiaenergy.com/customers/devices", {
                method: "GET",
                headers: {
                    authtoken: this.idtoken
                }
            });
        }
        const json = await res.json();
        const r = [];
        const devices = json.devices;
        for (let i = 0; i < devices.length; i++) {
            const subdevices = devices[i].devices;
            for (let j = 0; j < subdevices.length; j++) {
                const channels = subdevices[j].channels;
                for (let k = 0; k < channels.length; k++) {
                    const c = channels[k];
                    if (c.name) {
                        r.push({
                            name: c.name,
                            dgid: c.deviceGid
                        });
                    }
                }
            }
        }
        return r;
    }

    async getDeviceTimedUsage(interval, devices) {
        const dgids = {};
        const names = {};
        devices.forEach((d) => {
            names[d.name] = d;
            dgids[d.dgid] = true;
        });
        let res = await fetch(`https://api.emporiaenergy.com/AppAPI?apiMethod=getDeviceListUsages&deviceGids=${Object.keys(dgids).join("+")}&instant=${new Date().toISOString()}&scale=${interval}&energyUnit=KilowattHours`, {
            method: "GET",
            headers: {
                authtoken: this.idtoken
            }
        });
        if (res.status === 401) {
            await this.refreshTokens();
            res = await fetch(`https://api.emporiaenergy.com/AppAPI?apiMethod=getDeviceListUsages&deviceGids=${Object.keys(dgids).join("+")}&instant=${new Date().toISOString()}&scale=${interval}&energyUnit=KilowattHours`, {
                method: "GET",
                headers: {
                    authtoken: this.idtoken
                }
            });
        }
        const json = await res.json();
        const r = [];
        const channels = json.deviceListUsages.devices[0].channelUsages;
        for (let i = 0; i < channels.length; i++) {
            const c = channels[i];
            if (c.nestedDevices.length) {
                const subchannels = c.nestedDevices[0].channelUsages;
                for (let k = 0; k < subchannels.length; k++) {
                    const sc = subchannels[k];
                    const name = sc.name;
                    if (names[name]) {
                        names[name].usage = sc.usage;
                    }
                }
            }
            else {
                const name = c.name;
                if (names[name]) {
                    names[name].usage = c.usage;
                }
            }
        }
        return devices;
    }

}

module.exports = async function connect(username, password) {
    const api = new Api(username, password);
    return await api.login();
};
