import { setting, i18n, log, makeid, MonksEnhancedJournal } from "../monks-enhanced-journal.js";
import { EnhancedJournalSheet } from "../sheets/EnhancedJournalSheet.js";
import { MakeOffering } from "../apps/make-offering.js";

export class PersonSheet extends EnhancedJournalSheet {
    constructor(data, options) {
        super(data, options);
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: i18n("MonksEnhancedJournal.person"),
            template: "modules/monks-enhanced-journal/templates/sheets/person.html",
            tabs: [{ navSelector: ".tabs", contentSelector: ".sheet-body", initial: "description" }],
            dragDrop: [
                { dragSelector: ".document.actor", dropSelector: ".person-container" },
                { dragSelector: ".actor-img img", dropSelector: "null" },
                { dragSelector: ".sheet-icon", dropSelector: "#board" }
            ],
            scrollY: [".tab.entry-details .tab-inner", ".tab.description .tab-inner", ".relationships .items-list"]
        });
    }

    /*
    get allowedRelationships() {
        return ['organization', 'person', 'place', 'shop', 'quest', 'poi'];
    }*/

    static get type() {
        return 'person';
    }

    static get defaultObject() {
        return { relationships: [], attributes: {} };
    }

    async getData() {
        let data = await super.getData();

        if (foundry.utils.hasProperty(data, "data.flags.monks-enhanced-journal.attributes")) {
            // check to make sure the attributes are formatted correctly
            let changedObjectValues = false;
            let sheetSettings = {};
            let attributes = data?.data?.flags['monks-enhanced-journal']?.attributes || {};
            for (let [k, v] of Object.entries(attributes)) {
                if (typeof v == "object") {
                    sheetSettings[k] = { shown: !v.hidden };
                    attributes[k] = v.value;
                    changedObjectValues = true;
                }
            }
            if (changedObjectValues) {
                await this.object.update({ 'monks-enhanced-journal.flags.sheet-settings.attributes': sheetSettings });
                await this.object.setFlag('monks-enhanced-journal', 'attributes', attributes);
            }
        } else if (foundry.utils.hasProperty(data, "data.flags.monks-enhanced-journal.fields")) {
            // convert fields to attributes
            let fields = foundry.utils.getProperty(data, "data.flags.monks-enhanced-journal.fields");
            let attributes = {};
            let sheetSettings = {};
            let flags = foundry.utils.getProperty(data, "data.flags.monks-enhanced-journal") || {};
            let defaultSettings = this.object.constructor.sheetSettings() || {};

            for (let attr of Object.keys(defaultSettings.attributes)) {
                attributes[attr] = flags[attr] || "";
                if (fields[attr] != undefined)
                    sheetSettings[attr].shown = !!fields[attr]?.value;
            }
            foundry.utils.setProperty(data, "data.flags.monks-enhanced-journal.attributes", attributes);
            foundry.utils.setProperty(data, "data.flags.monks-enhanced-journal.sheet-settings.attributes", sheetSettings);
            await this.object.setFlag('monks-enhanced-journal', 'attributes', attributes);
            await this.object.update({ 'monks-enhanced-journal.flags.sheet-settings.attributes': sheetSettings });
        }

        data.relationships = await this.getRelationships();

        let actorLink = this.object.getFlag('monks-enhanced-journal', 'actor');
        if (actorLink) {
            let actor = actorLink.id ? game.actors.find(a => a.id == actorLink.id) : await fromUuid(actorLink);

            if (actor && actor.testUserPermission(game.user, "OBSERVER")) {
                data.actor = { uuid: actor.uuid, name: actor.name, img: actor.img };
            }
        }
        data.canViewActor = !!data.actor

        data.fields = this.fieldlist();

        let currency = (data.data.flags['monks-enhanced-journal'].currency || []);
        data.currency = MonksEnhancedJournal.currencies.map(c => {
            return { id: c.id, name: c.name, value: currency[c.id] ?? 0 };
        });

        data.offerings = this.getOfferings();

        data.has = {
            relationships: Object.keys(data.relationships || {})?.length,
            offerings: data.offerings?.length
        }

        data.hasRollTables = !!game.packs.get("monks-enhanced-journal.person-names");

        return data;
    }

    fieldlist() {
        let settings = this.sheetSettings() || {};
        let fields = MonksEnhancedJournal.convertObjectToArray(settings)?.attributes;
        let attributes = this.object.flags['monks-enhanced-journal'].attributes || {};
        return fields
            .filter(f => f.shown)
            .map(f => {
                let attr = attributes[f.id];
                return {
                    id: f.id,
                    name: f.name,
                    value: attr,
                    full: f.full
                }
            });
    }

    _documentControls() {
        let ctrls = [
            { text: '<i class="fas fa-search"></i>', type: 'text' },
            { id: 'search', type: 'input', text: i18n("MonksEnhancedJournal.SearchDescription"), callback: this.enhancedjournal.searchText },
            /*{ id: 'random', text: 'Generate Random Character', icon: 'fa-exchange-alt', conditional: game.user.isGM, callback: MonksEnhancedJournal.journal._randomizePerson },*/
            { id: 'show', text: i18n("MonksEnhancedJournal.ShowToPlayers"), icon: 'fa-eye', conditional: game.user.isGM, callback: this.enhancedjournal.doShowPlayers },
            { id: 'edit', text: i18n("MonksEnhancedJournal.EditDescription"), icon: 'fa-pencil-alt', conditional: this.isEditable, callback: () => { this.onEditDescription(); } },
            { id: 'sound', text: i18n("MonksEnhancedJournal.AddSound"), icon: 'fa-music', conditional: this.isEditable, callback: () => { this.onAddSound(); } },
            { id: 'convert', text: i18n("MonksEnhancedJournal.Convert"), icon: 'fa-clipboard-list', conditional: (game.user.isGM && this.isEditable), callback: () => { } }
        ];
        //if (game.modules.get("VoiceActor")?.active) {

        //}
        return ctrls.concat(super._documentControls());
    }

    activateListeners(html, enhancedjournal) {
        super.activateListeners(html, enhancedjournal);

        //$('.journal-header .actor-img img', html).click(this.openActor.bind(this));
        html.on('dragstart', ".actor-img img", TextEditor._onDragContentLink);

        $(".generate-name", html).click(this.generateName.bind(this));

        //onkeyup="textAreaAdjust(this)" style="overflow:hidden"
        $('.document-details textarea', html).keyup(this.textAreaAdjust.bind(this));

        $('.item-delete', html).on('click', $.proxy(this._deleteItem, this));
        $('.item-action', html).on('click', this.alterItem.bind(this));

        $('.item-hide', html).on('click', this.alterItem.bind(this));

        const actorOptions = this._getPersonActorContextOptions();
        if (actorOptions) new ContextMenu($(html), ".actor-img-container", actorOptions);

        $('.relationships .items-list h4', html).click(this.openRelationship.bind(this));
        $('.offerings .items-list .actor-icon', html).click(this.openOfferingActor.bind(this));

        //$('.item-relationship .item-field', html).on('change', this.alterRelationship.bind(this));

        $('.item-private', html).on('click', this.alterItem.bind(this));
        $('.make-offering', html).on('click', this.makeOffer.bind(this));
        $('.item-cancel', html).on('click', this.cancelOffer.bind(this));
        $('.item-accept', html).on('click', this.acceptOffer.bind(this));
        $('.item-reject', html).on('click', this.rejectOffer.bind(this));
    }

    _getSubmitData(updateData = {}) {
        let data = foundry.utils.expandObject(super._getSubmitData(updateData));

        if (data.relationships) {
            data.flags['monks-enhanced-journal'].relationships = foundry.utils.duplicate(this.object.getFlag("monks-enhanced-journal", "relationships") || []);
            for (let relationship of data.flags['monks-enhanced-journal'].relationships) {
                let dataRel = data.relationships[relationship.id];
                if (dataRel)
                    relationship = foundry.utils.mergeObject(relationship, dataRel);
            }
            delete data.relationships;
        }

        if (data.flags['monks-enhanced-journal']?.attributes) {
            data.flags['monks-enhanced-journal'].attributes = foundry.utils.mergeObject((this.object?.flags['monks-enhanced-journal']?.attributes || {}), (data.flags['monks-enhanced-journal']?.attributes || {}));
        }

        return foundry.utils.flattenObject(data);
    }

    _onDragStart(event) {
        if ($(event.currentTarget).hasClass("sheet-icon"))
            return super._onDragStart(event);

        const target = event.currentTarget;

        if (target.dataset.document == "Actor") {
            const dragData = {
                uuid: target.dataset.uuid,
                type: target.dataset.document
            };

            event.dataTransfer.setData("text/plain", JSON.stringify(dragData));
        }
    }

    _canDragDrop(selector) {
        return game.user.isGM || this.object.isOwner;
    }

    async _onDrop(event) {
        let data;
        try {
            data = JSON.parse(event.dataTransfer.getData('text/plain'));
        }
        catch (err) {
            return false;
        }

        if (data.type == 'Actor') {
            this.addActor(data);
        } else if (data.type == 'JournalEntry') {
            this.addRelationship(data);
        } else if (data.type == 'JournalEntryPage') {
            let doc = await fromUuid(data.uuid);
            data.id = doc?.parent.id;
            data.uuid = doc?.parent.uuid;
            data.type = "JournalEntry";
            this.addRelationship(data);
        } else if (data.type == 'Item') {
            let item = await fromUuid(data.uuid);
            if (!(item?.parent instanceof Actor)) {
                ui.notifications.warn("Offerings must come from an Actor");
                return;
            }
            new MakeOffering(this.object, this, {
                offering: {
                    actor: {
                        id: item.parent.id,
                        name: item.parent.name,
                        img: item.parent.img
                    },
                    items: [{
                        id: item.id,
                        itemName: item.name,
                        actorId: item.parent.id,
                        actorName: item.parent.name,
                        qty: 1
                    }]
                }
            }).render(true);
        }

        log('drop data', event, data);
    }

    async render(data) {
        let html = super.render(data);

        let that = this;
        $('.document-details textarea', html).each(function () {
            that.textAreaAdjust({ currentTarget: this });
        })

        return html;
    }

    textAreaAdjust(event) {
        let element = event.currentTarget;
        element.style.height = "1px";
        element.style.height = (25 + element.scrollHeight) + "px";
    }

    async addActor(data) {
        let actor = await this.getItemData(data);

        if (actor) {
            await this.object.update({
                name: actor.name,
                src: actor.img
            });
            await this.object.setFlag("monks-enhanced-journal", "actor", actor);
        }
    }

    openActor(event) {
        let actorLink = this.object.getFlag('monks-enhanced-journal', 'actor');
        let actor = game.actors.find(a => a.id == actorLink.id);
        if (!actor)
            return;

        if (event.newtab == true || event.altKey)
            actor.sheet.render(true);
        else
            this.open(actor, event);
    }

    removeActor() {
        this.object.unsetFlag('monks-enhanced-journal', 'actor');
        $('.actor-img-container', this.element).remove();
    }

    _getPersonActorContextOptions() {
        return [
            {
                name: "SIDEBAR.Delete",
                icon: '<i class="fas fa-trash"></i>',
                condition: () => game.user.isGM,
                callback: li => {
                    const id = li.data("id");
                    Dialog.confirm({
                        title: `${game.i18n.localize("SIDEBAR.Delete")} Actor Link`,
                        content: i18n("MonksEnhancedJournal.ConfirmRemoveLink"),
                        yes: this.removeActor.bind(this)
                    });
                }
            },
            {
                name: i18n("MonksEnhancedJournal.OpenActorSheet"),
                icon: '<i class="fas fa-user fa-fw"></i>',
                condition: () => game.user.isGM,
                callback: li => {
                    this.openActor.call(this, { newtab: true });
                }
            }
        ];
    }

    async generateName() {
        let pack = game.packs.get("monks-enhanced-journal.person-names");
        await pack.getDocuments();

        let race = foundry.utils.getProperty(this.object, "flags.monks-enhanced-journal.attributes.race.value") || foundry.utils.getProperty(this.object, "flags.monks-enhanced-journal.attributes.ancestry.value") || "Human"

        let firstName = "";
        let secondName = "";

        let nosecond = false;
        let first = pack.contents.find(c => c.name.toLowerCase() == (`${race} First Name`).toLowerCase());
        if (!first) {
            first = pack.contents.find(c => c.name.toLowerCase() == (`${race} Name`).toLowerCase());
            if (!first)
                first = first = pack.contents.find(c => c.name == "Human First Name");
            else
                nosecond = true;
        }

        if (first) firstName = await first.draw({ displayChat: false });
            
        let second = "";
        if (!nosecond) {
            second = pack.contents.find(c => c.name.toLowerCase() == (`${race} Last name`).toLowerCase());
            if (!second)
                second = pack.contents.find(c => c.name == "Human Last Name");
        }

        if (second) secondName = await second.draw({ displayChat: false });

        if (firstName || secondName)
            $('[name="name"]', this.element).val(`${firstName ? firstName.results[0].text : ""}${firstName && secondName ? " " : ""}${secondName ? secondName.results[0].text : ""}`).change();
    }
}
