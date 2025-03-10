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
            const device = devices[i];
            const subdevices = device.devices;
            for (let j = 0; j < subdevices.length; j++) {
                const channels = subdevices[j].channels;
                for (let k = 0; k < channels.length; k++) {
                    const c = channels[k];
                    r.push({
                        type: "monitor",
                        name: c.name || `Vue ${k + 1}`,
                        dgid: c.deviceGid,
                        channel: c.channelNum
                    });
                }
            }
            const channels = device.channels;
            if (device.outlet) {
                r.push({
                    type: "outlet",
                    name: device.locationProperties.displayName || `Outlet: ${device.manufacturerDeviceId.substr(-6)}`,
                    dgid: device.deviceGid,
                    channel: channels[0].channelNum
                });
            }
            else {
                for (let k = 0; k < channels.length; k++) {
                    const c = channels[k];
                    if (c.type === "Main") {
                        r.push({
                            type: "monitor",
                            name: device.locationProperties.displayName || `Vue: ${device.deviceGid}`,
                            dgid: c.deviceGid,
                            channel: c.channelNum
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
            names[`${d.dgid}:${d.channel}`] = d;
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
        const devicelist = json.deviceListUsages.devices;
        for (let x = 0; x < devicelist.length; x++) {
            const channels = devicelist[x].channelUsages;
            for (let i = 0; i < channels.length; i++) {
                const c = channels[i];
                for (let j = 0; j < c.nestedDevices.length; j++) {
                    const subchannels = c.nestedDevices[j].channelUsages;
                    for (let k = 0; k < subchannels.length; k++) {
                        const sc = subchannels[k];
                        const id = `${sc.deviceGid}:${sc.channelNum}`
                        if (names[id]) {
                            names[id].usage = sc.usage;
                        }
                    }
                }
                const id = `${c.deviceGid}:${c.channelNum}`;
                if (names[id]) {
                    names[id].usage = c.usage;
                }
            }
        }
        return devices;
    }

    async getOutletState(devices) {
        const names = {};
        devices.forEach((d) => {
            if (d.type === "outlet") {
                names[`${d.dgid}`] = d;
            }
        });
        let res = await fetch(`https://api.emporiaenergy.com/customers/devices/status`, {
            method: "GET",
            headers: {
                authtoken: this.idtoken
            }
        });
        if (res.status === 401) {
            await this.refreshTokens();
            res = await fetch(`https://api.emporiaenergy.com/customers/devices/status`, {
                method: "GET",
                headers: {
                    authtoken: this.idtoken
                }
            });
        }
        const json = await res.json();
        json.outlets.forEach(outlet => {
            if (names[outlet.deviceGid]) {
                names[outlet.deviceGid].on = outlet.outletOn;
            }
        });
        return devices;
    }

    async updateOutletState(outlet) {
        const body = JSON.stringify({
            deviceGid: outlet.dgid,
            outletOn: outlet.on
        });
        let res = await fetch(`https://api.emporiaenergy.com/devices/outlet`, {
            method: "PUT",
            headers: {
                authtoken: this.idtoken,
                "Content-Type": "application/json"
            },
            body: body
        });
        if (res.status === 401) {
            await this.refreshTokens();
            res = await fetch(`https://api.emporiaenergy.com/devices/outlet`, {
                method: "PUT",
                headers: {
                    authtoken: this.idtoken,
                    "Content-Type": "application/json"
                },
                body: body
            });
        }
        await res.json();
        return res.ok;
    }

}

module.exports = async function connect(username, password) {
    const api = new Api(username, password);
    return await api.login();
};
